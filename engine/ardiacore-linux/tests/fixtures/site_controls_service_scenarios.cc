#include "ardia/linux/ac_linux_site_controls_service.h"
#include "ardia/linux/ac_linux_navigation_hold.h"
#include "ardia/linux/ac_linux_profile_service.h"

#include <unistd.h>

#include <algorithm>
#include <cassert>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <map>
#include <set>
#include <string>
#include <vector>

bool (*g_ardia_restricted_component_extension)(const extensions::ExtensionId& extension_id) = nullptr;
void (*g_ardia_linux_navigation_throttles)(content::NavigationThrottleRegistry& registry) = nullptr;

std::map<std::string, Profile*>& Registry() {
  static std::map<std::string, Profile*> registry;
  return registry;
}

std::vector<std::string>& Resolved() {
  static std::vector<std::string> resolved;
  return resolved;
}

bool ardiacore::LinuxProfileHosts(std::string_view id, const Profile* window_profile) {
  auto found = Registry().find(std::string(id));
  return found != Registry().end() && found->second == window_profile && !found->second->ShutdownStarted();
}

void ardiacore::ResolveLinuxProfile(std::string_view id, LinuxProfileDone done) {
  Resolved().push_back(std::string(id));
  const std::string key = id.empty() ? "default" : std::string(id);
  if (key == "gone") return std::move(done).Run(nullptr, linux_profiles::ProfileError::kDeleted);
  auto found = Registry().find(key);
  Profile* profile = found == Registry().end() ? nullptr : found->second;
  base::PostTask(base::OnceClosure([done = std::move(done), profile]() mutable {
    std::move(done).Run(profile, profile ? linux_profiles::ProfileError::kNone : linux_profiles::ProfileError::kUnavailable);
  }));
}

namespace {

struct EngineCall {
  std::string service;
  std::string profile;
  std::string args;
};

std::string& EngineError() {
  static std::string error;
  return error;
}

std::vector<EngineCall>& EngineCalls() {
  static std::vector<EngineCall> calls;
  return calls;
}

std::map<std::pair<std::string, std::string>, std::string>& Exceptions() {
  static std::map<std::pair<std::string, std::string>, std::string> exceptions;
  return exceptions;
}

bool& ClearFails() {
  static bool fails = false;
  return fails;
}

std::string Reply(base::DictValue value) { return *base::WriteJson(base::Value(std::move(value))); }

}

void ac_engine_call(const char* name, const char* profile_dir, const char* args_json, ac_engine_reply_t reply, void* context) {
  EngineCalls().push_back({name, profile_dir, args_json});
  auto args = base::JSONReader::Read(args_json, 0);
  assert(args && args->is_dict());
  const base::DictValue& input = args->GetDict();
  const std::string service = name;
  const base::Value* otr_flag = input.Find("offTheRecord");
  const bool off_the_record = otr_flag && otr_flag->is_bool() && otr_flag->GetBool();
  const std::string origin = (off_the_record ? "otr|" : "") + (input.FindString("origin") ? *input.FindString("origin") : "");
  std::string json;
  if (!EngineError().empty()) {
    json = Reply(base::DictValue().Set("error", std::exchange(EngineError(), "")));
  } else if (service == "ac_site_settings_get") {
    base::DictValue settings;
    for (const char* type : {"camera", "microphone", "location", "notifications"}) {
      auto found = Exceptions().find({origin, type});
      settings.Set(type, base::DictValue().Set("value", found == Exceptions().end() ? "ask" : found->second)
                             .Set("isDefault", base::Value(found == Exceptions().end())));
    }
    json = Reply(base::DictValue().Set("settings", std::move(settings)));
  } else if (service == "ac_site_settings_set") {
    const std::string type = *input.FindString("type");
    const std::string value = *input.FindString("value");
    if (value == "default") Exceptions().erase({origin, type});
    else Exceptions()[{origin, type}] = value;
    json = Reply(base::DictValue());
  } else if (service == "ac_site_settings_reset") {
    std::erase_if(Exceptions(), [&](const auto& entry) { return entry.first.first == origin; });
    json = Reply(base::DictValue());
  } else if (service == "ac_site_settings_origins") {
    std::set<std::string> origins;
    for (const auto& [key, value] : Exceptions()) {
      if (key.first.starts_with("otr|") == off_the_record) origins.insert(off_the_record ? key.first.substr(4) : key.first);
    }
    base::ListValue list;
    for (const auto& o : origins) list.Append(base::Value(o));
    json = Reply(base::DictValue().Set("origins", base::Value(std::move(list))));
  } else if (service == "ac_site_data_clear") {
    json = Reply(base::DictValue().Set("cookies", base::Value(2)).Set("storage", base::Value(true)));
  } else if (service == "ac_browsing_data_clear") {
    json = Reply(base::DictValue().Set("ok", base::Value(!ClearFails())));
  } else {
    json = Reply(base::DictValue().Set("error", "unknown service"));
  }
  base::PostTask(base::OnceClosure([reply, context, json]() { reply(context, json.c_str()); }));
}

namespace {

struct Result {
  bool done = false;
  bool ok = false;
  base::Value value;
  std::string code;
  std::string message;
};

std::shared_ptr<Result> Call(Profile* profile, const std::string& name, const std::string& args,
                             const std::string& requested = "default", Profile* page = nullptr) {
  auto result = std::make_shared<Result>();
  base::Value transported(args);
  ardia::LinuxSiteControlsCall(profile, page ? page : profile, name, requested, &transported,
      ardia::SiteControlsDone([result](bool ok, base::Value value) {
        assert(!result->done);
        result->done = true;
        result->ok = ok;
        if (!ok) {
          result->code = *value.GetDict().FindString("code");
          result->message = *value.GetDict().FindString("message");
        }
        result->value = std::move(value);
      }));
  return result;
}

void Advance(int64_t ms) {
  for (int64_t step = 0; step < ms; step += 25) {
    base::FakeNowMs() += 25;
    base::RunTasks();
    base::FireTimers();
    base::RunTasks();
  }
}

std::shared_ptr<Result> Settle(std::shared_ptr<Result> result, int64_t limit_ms = 3000) {
  for (int64_t waited = 0; !result->done && waited < limit_ms; waited += 25) Advance(25);
  assert(result->done);
  return result;
}

const base::DictValue& Dict(const std::shared_ptr<Result>& result) {
  assert(result->ok && result->value.is_dict());
  return result->value.GetDict();
}

std::string ValueOf(const std::shared_ptr<Result>& settings, const char* type) {
  return *Dict(settings).FindDict(type)->FindString("value");
}

bool IsDefault(const std::shared_ptr<Result>& settings, const char* type) {
  return Dict(settings).FindDict(type)->Find("isDefault")->GetBool();
}

std::filesystem::path MakeBlocker(const std::filesystem::path& root, bool with_bridge = true) {
  const auto dir = root / "extensions" / "ublock";
  std::filesystem::create_directories(dir);
  std::ofstream(dir / "manifest.json") << R"({"manifest_version":2,"version":"1.75.0.22","version_name":"1.75.0","key":"x"})";
  if (with_bridge) std::ofstream(dir / "ardia-linux-bridge.html") << "<html></html>";
  return dir;
}

std::vector<base::Value>& Events() {
  static std::vector<base::Value> events;
  return events;
}

void SitePermissionsThroughTheService(Profile& profile, Profile& incognito) {
  const std::string origin = R"("origin":"https://camera.ardia.test")";
  auto before = Settle(Call(&profile, "sites.settings", "{" + origin + R"(,"engine":"chromium"})"));
  assert(ValueOf(before, "camera") == "ask" && IsDefault(before, "camera"));
  EngineCalls().clear();
  auto grant = Settle(Call(&profile, "sites.setSetting", "{" + origin + R"(,"type":"camera","value":"allow","engine":"chromium"})"));
  assert(grant->ok && grant->value.is_none());
  assert(EngineCalls().size() == 1 && EngineCalls()[0].service == "ac_site_settings_set");
  assert(EngineCalls()[0].profile == "/profiles/Default");
  assert(EngineCalls()[0].args.find("engine") == std::string::npos);
  auto granted = Settle(Call(&profile, "sites.settings", "{" + origin + "}"));
  assert(ValueOf(granted, "camera") == "allow" && !IsDefault(granted, "camera"));
  Settle(Call(&profile, "sites.setSetting", "{" + origin + R"(,"type":"notifications","value":"block"})"));
  auto origins = Settle(Call(&profile, "sites.origins", "{}"));
  assert(origins->ok && origins->value.GetList().size() == 1);
  auto revoke = Settle(Call(&profile, "sites.setSetting", "{" + origin + R"(,"type":"camera","value":"default"})"));
  assert(revoke->ok);
  auto revoked = Settle(Call(&profile, "sites.settings", "{" + origin + "}"));
  assert(IsDefault(revoked, "camera") && ValueOf(revoked, "notifications") == "block");
  Settle(Call(&profile, "sites.reset", "{" + origin + "}"));
  assert(IsDefault(Settle(Call(&profile, "sites.settings", "{" + origin + "}")), "notifications"));
  assert(Settle(Call(&profile, "sites.origins", "{}"))->value.GetList().size() == 0);
  auto cleared = Settle(Call(&profile, "sites.clearData", "{" + origin + "}"));
  assert(cleared->ok && Dict(cleared).Find("cookies")->GetInt() == 2);

  EngineCalls().clear();
  auto from_private = Settle(Call(&incognito, "sites.setSetting", "{" + origin + R"(,"type":"camera","value":"allow"})"));
  assert(!from_private->ok && from_private->code == "ERR_PROFILE_UNAVAILABLE");
  auto otr = Settle(Call(&profile, "sites.origins", "{}", "otr"));
  assert(otr->code == "ERR_PROFILE_PRIVATE");
  auto private_id = Settle(Call(&profile, "sites.settings", "{" + origin + "}", "incognito:w1@default"));
  assert(private_id->code == "ERR_PROFILE_WINDOW");
  auto deleted = Settle(Call(&profile, "sites.origins", "{}", "gone"));
  assert(deleted->code == "ERR_PROFILE_DELETED");
  auto unknown = Settle(Call(&profile, "sites.origins", "{}", "nobody"));
  assert(unknown->code == "ERR_PROFILE_UNAVAILABLE");
  auto bad = Settle(Call(&profile, "sites.setSetting", "{" + origin + R"(,"type":"camera","value":"forever"})"));
  assert(bad->code == "ERR_SITE_REQUEST");
  auto webkit = Settle(Call(&profile, "sites.settings", "{" + origin + R"(,"engine":"webkit"})"));
  assert(webkit->code == "ERR_UNKNOWN_CALL");
  auto not_json = Settle(Call(&profile, "sites.origins", "{"));
  assert(not_json->code == "ERR_ENGINE");
  auto none = std::make_shared<Result>();
  base::Value no_args("{}");
  ardia::LinuxSiteControlsCall(nullptr, nullptr, "sites.origins", "", &no_args, ardia::SiteControlsDone([none](bool ok, base::Value value) {
    none->done = true;
    none->ok = ok;
    none->code = *value.GetDict().FindString("code");
  }));
  assert(none->done && none->code == "ERR_PROFILE_UNAVAILABLE");
  assert(EngineCalls().empty());
  Resolved().clear();
  auto isolated = Settle(Call(&profile, "sites.setSetting", "{" + origin + R"(,"type":"camera","value":"block"})", "work"));
  assert(isolated->ok && EngineCalls().size() == 1 && EngineCalls()[0].profile == "/profiles/Work");
  assert(Resolved().size() == 1 && Resolved()[0] == "work");
  Settle(Call(&profile, "sites.setSetting", "{" + origin + R"(,"type":"camera","value":"default"})", "work"));
  auto app_level = Settle(Call(&profile, "contentBlocker.devFailNextMessage", "{}", "work"));
  assert(app_level->ok && Resolved().size() == 2);
}

bool OffTheRecordArg(const EngineCall& call) {
  const auto parsed = base::JSONReader::Read(call.args, 0);
  const base::Value* flag = parsed->GetDict().Find("offTheRecord");
  return flag && flag->is_bool() && flag->GetBool();
}

void PrivateSessionThroughTheService(Profile& profile, Profile& incognito) {
  const std::string origin = R"("origin":"https://private.ardia.test")";
  const std::string session = "incognito:w1@default";
  Registry()[session] = &incognito;
  EngineCalls().clear();
  Resolved().clear();
  auto grant = Settle(Call(&profile, "sites.setSetting", "{" + origin + R"(,"type":"camera","value":"allow"})", session, &incognito));
  assert(grant->ok && EngineCalls().size() == 1 && EngineCalls()[0].service == "ac_site_settings_set");
  assert(EngineCalls()[0].profile == "/profiles/Default");
  assert(OffTheRecordArg(EngineCalls()[0]));
  assert(Resolved().empty());
  auto in_private = Settle(Call(&profile, "sites.settings", "{" + origin + "}", session, &incognito));
  assert(ValueOf(in_private, "camera") == "allow");
  auto in_regular = Settle(Call(&profile, "sites.settings", "{" + origin + "}"));
  assert(ValueOf(in_regular, "camera") == "ask" && IsDefault(in_regular, "camera"));
  assert(Settle(Call(&profile, "sites.origins", "{}"))->value.GetList().size() == 0);
  auto private_origins = Settle(Call(&profile, "sites.origins", "{}", session, &incognito));
  assert(private_origins->ok && private_origins->value.GetList().size() == 1);
  assert(EngineCalls().size() == 5);
  for (size_t index : {0, 1, 4}) assert(OffTheRecordArg(EngineCalls()[index]));
  for (size_t index : {2, 3}) assert(EngineCalls()[index].args.find("offTheRecord") == std::string::npos);
  assert(Settle(Call(&profile, "sites.reset", "{" + origin + "}", session, &incognito))->ok);
  assert(Settle(Call(&profile, "sites.clearData", "{" + origin + "}", session, &incognito))->ok);
  EngineCalls().clear();
  EngineError() = "no private session";
  auto ended = Settle(Call(&profile, "sites.settings", "{" + origin + "}", session, &incognito));
  assert(ended->code == "ERR_PROFILE_ENDING");
  EngineCalls().clear();
  auto clear_all = Settle(Call(&profile, "profiles.clearBrowsingData", R"({"types":["cache"]})", session, &incognito));
  assert(clear_all->code == "ERR_PROFILE_PRIVATE");
  Profile stranger("/profiles/Default", true, &profile);
  auto foreign = Settle(Call(&profile, "sites.settings", "{" + origin + "}", session, &stranger));
  assert(foreign->code == "ERR_PROFILE_WINDOW");
  EngineCalls().clear();
  Resolved().clear();
  for (const char* requested : {"default", "", "work"}) {
    auto as_regular = Settle(Call(&profile, "sites.settings", "{" + origin + "}", requested, &incognito));
    assert(as_regular->code == "ERR_PROFILE_WINDOW");
    auto set_regular = Settle(Call(&profile, "sites.setSetting", "{" + origin + R"(,"type":"camera","value":"block"})", requested, &incognito));
    assert(set_regular->code == "ERR_PROFILE_WINDOW");
    auto clear_regular = Settle(Call(&profile, "profiles.clearBrowsingData", R"({"types":["cache"]})", requested, &incognito));
    assert(clear_regular->code == "ERR_PROFILE_PRIVATE");
  }
  assert(EngineCalls().empty() && Resolved().empty());
  incognito.shutdown_started = true;
  auto closing = Settle(Call(&profile, "sites.setSetting", "{" + origin + R"(,"type":"camera","value":"block"})", session, &incognito));
  assert(closing->code == "ERR_PROFILE_ENDING");
  incognito.shutdown_started = false;
  assert(EngineCalls().empty());
  Registry().erase(session);
}

void BrowsingDataThroughTheService(Profile& profile, Profile& incognito) {
  EngineCalls().clear();
  auto hour = Settle(Call(&profile, "profiles.clearBrowsingData", R"({"types":["siteData","cache"],"since":1761500000000})"));
  assert(hour->ok && hour->value.is_none());
  assert(EngineCalls().size() == 1 && EngineCalls()[0].service == "ac_browsing_data_clear");
  auto sent = base::JSONReader::Read(EngineCalls()[0].args, 0);
  assert(sent->GetDict().Find("types")->GetList().size() == 2 && sent->GetDict().Find("since")->GetDouble() == 1761500000000.0);
  auto all = Settle(Call(&profile, "profiles.clearBrowsingData", R"({"types":["history","siteData","cache","downloads"],"since":null})"));
  assert(all->ok);
  assert(!base::JSONReader::Read(EngineCalls()[1].args, 0)->GetDict().Find("since"));
  ClearFails() = true;
  auto partial = Settle(Call(&profile, "profiles.clearBrowsingData", R"({"types":["cache"],"since":null})"));
  assert(partial->code == "ERR_CLEAR_INCOMPLETE");
  ClearFails() = false;
  EngineCalls().clear();
  assert(Settle(Call(&profile, "profiles.clearBrowsingData", R"({"types":["passwords"]})"))->code == "ERR_SITE_REQUEST");
  assert(Settle(Call(&profile, "profiles.clearBrowsingData", R"({"types":["cache"]})", "incognito:w1@default"))->code == "ERR_PROFILE_PRIVATE");
  assert(Settle(Call(&incognito, "profiles.clearBrowsingData", R"({"types":["cache"]})"))->code == "ERR_PROFILE_UNAVAILABLE");
  assert(EngineCalls().empty());
}

void MissingBlocker(const std::filesystem::path& scratch) {
  base::FakeExeDir() = base::FilePath((scratch / "empty").string());
  Profile profile("/profiles/Missing");
  ardia::StartLinuxContentBlocker(&profile, &profile);
  base::RunTasks();
  auto state = Settle(Call(&profile, "contentBlocker.state", "{}"));
  assert(state->ok);
  const base::DictValue& stats = *Dict(state).FindDict("stats");
  assert(!stats.Find("ready")->GetBool() && *stats.FindString("error") == "the content blocker is not installed");
  auto set = Settle(Call(&profile, "contentBlocker.setEnabled", R"({"enabled":false})"));
  assert(!set->ok && set->code == "ERR_CONTENT_BLOCKER_UNAVAILABLE");
  assert(profile.loader.added.empty() && Loads().pages_created == 0);

  base::FakeExeDir() = base::FilePath(scratch.string());
  MakeBlocker(scratch / "nobridge", false);
  base::FakeExeDir() = base::FilePath((scratch / "nobridge").string());
  Profile stale("/profiles/NoBridge");
  ardia::StartLinuxContentBlocker(&stale, &stale);
  base::RunTasks();
  assert(Settle(Call(&stale, "contentBlocker.setListEnabled", R"({"id":"easylist","enabled":true})"))->code == "ERR_CONTENT_BLOCKER_UNAVAILABLE");
}

void WrongComponent(const std::filesystem::path& scratch) {
  MakeBlocker(scratch / "wrong");
  base::FakeExeDir() = base::FilePath((scratch / "wrong").string());
  Profile profile("/profiles/Wrong");
  profile.loader.id_for_path = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  auto pending = Call(&profile, "contentBlocker.isAllowed", R"({"host":"example.com"})");
  base::RunTasks();
  profile.system.ready_event.Signal();
  Settle(pending);
  assert(pending->code == "ERR_CONTENT_BLOCKER_UNAVAILABLE" && pending->message == "the content blocker didn't load");
  assert(profile.loader.removed.size() == 1 && profile.loader.removed[0] == "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert(Loads().pages_created == 0);
}

void ComponentNotEnabled(const std::filesystem::path& scratch) {
  MakeBlocker(scratch / "disabled");
  base::FakeExeDir() = base::FilePath((scratch / "disabled").string());
  Profile profile("/profiles/Disabled");
  profile.loader.enables = false;
  auto pending = Call(&profile, "contentBlocker.setEnabled", R"({"enabled":true})");
  base::RunTasks();
  profile.system.ready_event.Signal();
  Settle(pending, 1000);
  assert(pending->code == "ERR_CONTENT_BLOCKER_UNAVAILABLE" && pending->message == "the content blocker didn't load");
  assert(profile.loader.added.size() == 1 && profile.loader.removed.size() == 1);
  assert(profile.loader.removed[0] == "fajbdaomknpkicfjcpipdmcpoamdmilh");
  auto state = Settle(Call(&profile, "contentBlocker.state", "{}"), 100);
  assert(state->ok && !Dict(state).FindDict("stats")->Find("ready")->GetBool());
  assert(Loads().pages_created == 0);
}

void QueuedBeforeLoadExpires(const std::filesystem::path& scratch) {
  MakeBlocker(scratch / "never");
  base::FakeExeDir() = base::FilePath((scratch / "never").string());
  Profile profile("/profiles/Never");
  auto state = Call(&profile, "contentBlocker.state", "{}");
  auto set = Call(&profile, "contentBlocker.setEnabled", R"({"enabled":false})");
  Advance(20000);
  assert(!state->done && !set->done);
  Advance(3000);
  assert(state->done && state->ok && *Dict(state).FindDict("stats")->FindString("error") == "the call timed out");
  assert(set->done && set->code == "ERR_CONTENT_BLOCKER_UNAVAILABLE" && set->message == "the call timed out");
  assert(Loads().pages_created == 0 && profile.loader.added.empty());
}

void OtherPageProfiles(Profile& app, Profile& work, Profile& incognito) {
  EngineCalls().clear();
  auto state = Settle(Call(&app, "contentBlocker.state", "{}", "work", &work), 200);
  assert(state->ok && !Dict(state).FindDict("stats")->Find("ready")->GetBool());
  assert(*Dict(state).FindDict("stats")->FindString("error") == "the content blocker isn't available in this profile yet");
  auto set = Settle(Call(&app, "contentBlocker.setAllowed", R"({"host":"a.test","allowed":true})", "work", &work), 200);
  assert(set->code == "ERR_CONTENT_BLOCKER_UNAVAILABLE");
  auto from_private = Settle(Call(&app, "contentBlocker.devFailNextMessage", "{}", "incognito:w@default", &incognito), 200);
  assert(from_private->ok);
  auto sites = Settle(Call(&app, "sites.origins", "{}", "work", &work));
  assert(sites->ok && EngineCalls().size() == 1 && EngineCalls()[0].profile == "/profiles/Work");
}

void WorkingBlocker(const std::filesystem::path& scratch) {
  const auto dir = MakeBlocker(scratch / "working");
  base::FakeExeDir() = base::FilePath((scratch / "working").string());
  auto profile = std::make_unique<Profile>("/profiles/Default2");
  Profile incognito("/profiles/Default2", true, profile.get());
  ardia::StartLinuxContentBlocker(&incognito, &incognito);
  ardia::StartLinuxContentBlocker(profile.get(), &incognito);
  ardia::StartLinuxContentBlocker(profile.get(), profile.get());
  base::RunTasks();
  assert(profile->loader.added.empty());
  auto early = Call(profile.get(), "contentBlocker.state", "{}");
  Advance(100);
  assert(!early->done && Loads().pages_created == 0);
  profile->system.ready_event.Signal();
  Settle(early);
  assert(profile->loader.added.size() == 1 && profile->loader.added[0] == std::filesystem::canonical(dir).string());
  assert(g_ardia_restricted_component_extension("fajbdaomknpkicfjcpipdmcpoamdmilh"));
  assert(!g_ardia_restricted_component_extension("mhjfbmdgcfjbbpaeojofohoefgiehjai"));
  assert(Loads().pages_created == 1 && Loads().live.size() == 1);
  content::WebContents* page = Loads().live[0];
  assert(page->hidden && page->view_type == 9 && page->extension_observer && page->profile == profile.get());
  assert(page->requested.spec() == "chrome-extension://fajbdaomknpkicfjcpipdmcpoamdmilh/ardia-linux-bridge.html");
  const base::DictValue& state = Dict(early);
  assert(state.Find("enabled")->GetBool() && *state.FindString("version") == "1.75.0");
  assert(state.FindDict("stats")->Find("ready")->GetBool() && state.FindDict("stats")->Find("networkFilters")->GetInt() == 300);
  assert(state.Find("lists")->GetList().size() == 3);

  Events().clear();
  auto allow = Settle(Call(profile.get(), "contentBlocker.setAllowed", R"({"host":"Example.COM","allowed":true})"));
  assert(allow->ok && allow->value.is_none());
  Advance(200);
  assert(Events().size() == 1 && Events()[0].GetDict().Find("ready")->GetBool());
  assert(Settle(Call(profile.get(), "contentBlocker.isAllowed", R"({"host":"news.example.com"})"))->value.GetBool());
  assert(!Settle(Call(profile.get(), "contentBlocker.isAllowed", R"({"host":"other.test"})", "incognito:w2@default"))->value.GetBool());
  auto hosts = Settle(Call(profile.get(), "contentBlocker.state", "{}"));
  assert(Dict(hosts).Find("allowedHosts")->GetList().size() == 1);
  assert(Dict(hosts).Find("allowedHosts")->GetList()[0].GetString() == "example.com");
  auto bad_host = Settle(Call(profile.get(), "contentBlocker.setAllowed", R"({"host":"/^(?:ardia-blocking-off|)/","allowed":true})"));
  assert(bad_host->code == "ERR_CONTENT_BLOCKER_REQUEST");
  const auto allowed_before = Bridge().whitelist;
  for (const char* change : {R"({"host":"private.test","allowed":true})", R"({"host":"example.com","allowed":false})"}) {
    auto from_private_window = Settle(Call(profile.get(), "contentBlocker.setAllowed", change, "", &incognito));
    assert(from_private_window->code == "ERR_PROFILE_PRIVATE");
    auto named_private = Settle(Call(profile.get(), "contentBlocker.setAllowed", change, "incognito:w2@default"));
    assert(named_private->code == "ERR_PROFILE_PRIVATE");
  }
  assert(Settle(Call(profile.get(), "contentBlocker.setEnabled", R"({"enabled":false})", "", &incognito))->code == "ERR_PROFILE_PRIVATE");
  assert(Settle(Call(profile.get(), "contentBlocker.setListEnabled", R"({"id":"fanboy-cookiemonster","enabled":true})", "", &incognito))->code == "ERR_PROFILE_PRIVATE");
  assert(Settle(Call(profile.get(), "contentBlocker.setEnabled", R"({"enabled":false})", "incognito:w2@default"))->code == "ERR_PROFILE_PRIVATE");
  assert(Bridge().whitelist == allowed_before && !Bridge().lists["fanboy-cookiemonster"]);
  assert(Settle(Call(profile.get(), "contentBlocker.isAllowed", R"({"host":"news.example.com"})", "", &incognito))->value.GetBool());
  assert(Settle(Call(profile.get(), "contentBlocker.state", "{}", "", &incognito))->ok);
  Advance(200);
  assert(Events().size() == 1);
  auto off = Settle(Call(profile.get(), "contentBlocker.setEnabled", R"({"enabled":false})"));
  assert(off->ok && !Bridge().auto_update);
  Advance(200);
  assert(Events().size() == 2 && !Events()[1].GetDict().Find("enabled")->GetBool());
  auto missing_list = Settle(Call(profile.get(), "contentBlocker.setListEnabled", R"({"id":"nope","enabled":true})"));
  assert(missing_list->code == "ERR_CONTENT_BLOCKER_UNAVAILABLE" && missing_list->message == "no list nope");
  Advance(200);
  assert(Events().size() == 2);
  assert(Settle(Call(profile.get(), "contentBlocker.setListEnabled", R"({"id":"fanboy-cookiemonster","enabled":true})"))->ok);
  assert(Bridge().lists["fanboy-cookiemonster"]);
  assert(Loads().pages_created == 1);

  Bridge().mode = FakeBridge::Mode::kCrashOnSend;
  auto crashed = Settle(Call(profile.get(), "contentBlocker.isAllowed", R"({"host":"example.com"})"));
  assert(crashed->ok && crashed->value.GetBool());
  assert(Loads().pages_created == 2 && Loads().live.size() == 1);

  Bridge().mode = FakeBridge::Mode::kDropFirstReply;
  auto dropped = Call(profile.get(), "contentBlocker.state", "{}");
  Advance(1000);
  assert(!dropped->done);
  Advance(22000);
  assert(dropped->done && dropped->ok && !Dict(dropped).FindDict("stats")->Find("ready")->GetBool());
  assert(*Dict(dropped).FindDict("stats")->FindString("error") == "the call timed out");
  assert(Loads().live.empty());
  assert(Settle(Call(profile.get(), "contentBlocker.state", "{}"))->ok);
  assert(Loads().live.size() == 1);

  Bridge().mode = FakeBridge::Mode::kNotReady;
  auto unready = Call(profile.get(), "contentBlocker.isAllowed", R"({"host":"example.com"})");
  Advance(600);
  assert(!unready->done && Loads().pages_created >= 5);
  Bridge().mode = FakeBridge::Mode::kAnswer;
  Settle(unready);
  assert(unready->ok && unready->value.GetBool());

  Advance(31000);
  assert(Loads().live.empty());
  Loads().commit_instead = "https://evil.test/";
  auto foreign = Call(profile.get(), "contentBlocker.state", "{}");
  const int requests_before = Bridge().requests;
  Advance(25);
  base::RunTasks();
  for (auto* contents : std::vector<content::WebContents*>(Loads().live)) contents->FailLoad(-2);
  Advance(1500);
  assert(!foreign->done && Bridge().requests == requests_before);
  Loads().commit_instead.clear();
  Settle(foreign);
  assert(foreign->ok && Dict(foreign).FindDict("stats")->Find("ready")->GetBool());

  assert(Settle(Call(profile.get(), "contentBlocker.devFailNextMessage", "{}"))->ok);
  auto dev = Settle(Call(profile.get(), "contentBlocker.setEnabled", R"({"enabled":true})"));
  assert(dev->code == "ERR_CONTENT_BLOCKER_UNAVAILABLE" && dev->message == "getWhitelist: failed (dev)");
  assert(Settle(Call(profile.get(), "contentBlocker.setEnabled", R"({"enabled":true})"))->ok);
  assert(Settle(Call(profile.get(), "contentBlocker.devDelayNextLoad", R"({"ms":5})"))->code == "ERR_CONTENT_BLOCKER_UNAVAILABLE");

  Advance(1000);
  assert(Loads().live.size() == 1);
  Advance(31000);
  assert(Loads().live.empty());

  Bridge().mode = FakeBridge::Mode::kSilent;
  std::vector<std::shared_ptr<Result>> pending;
  for (size_t i = 0; i < 64; ++i) pending.push_back(Call(profile.get(), "contentBlocker.state", "{}"));
  auto busy = Call(profile.get(), "contentBlocker.state", "{}");
  assert(busy->done && busy->code == "ERR_CONTENT_BLOCKER_BUSY");
  Advance(200);
  assert(Loads().live.size() == 1);
  profile.reset();
  base::RunTasks();
  for (auto& result : pending) {
    assert(result->done && result->ok);
    assert(*result->value.GetDict().FindDict("stats")->FindString("error") == "profile gone");
  }
  assert(Loads().live.empty());
  Advance(500);
  Bridge().mode = FakeBridge::Mode::kAnswer;
}

struct Navigation {
  Navigation(Profile* profile, const std::string& url) : contents(content::WebContents::CreateParams(profile)) {
    registry.handle.contents = &contents;
    registry.handle.url = GURL(url);
    g_ardia_linux_navigation_throttles(registry);
    result = registry.throttles.empty() ? content::NavigationThrottle::PROCEED : registry.throttles[0]->WillStartRequest();
  }
  bool deferred() const { return result == content::NavigationThrottle::DEFER; }
  int resumed() const { return registry.throttles.empty() ? 0 : registry.throttles[0]->resumed; }
  content::WebContents contents;
  content::NavigationThrottleRegistry registry;
  content::NavigationThrottle::ThrottleCheckResult result = content::NavigationThrottle::PROCEED;
};

bool Has(const std::vector<std::string>& items, const std::string& item) {
  return std::find(items.begin(), items.end(), item) != items.end();
}

void HoldsFirstLaunchNavigationsUntilReady(const std::filesystem::path& scratch) {
  assert(g_ardia_linux_navigation_throttles);
  MakeBlocker(scratch / "hold");
  base::FakeExeDir() = base::FilePath((scratch / "hold").string());

  Profile existing("/profiles/Existing");
  ardia::StartLinuxContentBlocker(&existing, &existing);
  assert(!ardia::LinuxNavigationsHeld(&existing));
  Navigation unheld(&existing, "https://ads.test/banner.png");
  assert(unheld.registry.throttles.empty() && !unheld.deferred());

  Profile fresh("/profiles/Fresh");
  fresh.new_profile = true;
  Profile fresh_private("/profiles/Fresh", true, &fresh);
  Bridges()[&fresh];
  ardia::StartLinuxContentBlocker(&fresh, &fresh);
  assert(ardia::LinuxNavigationsHeld(&fresh) && ardia::LinuxNavigationsHeld(&fresh_private));
  Navigation page(&fresh, "https://ads.test/banner.png");
  Navigation in_private(&fresh_private, "http://ads.test/");
  Navigation shell(&fresh, "chrome://ardia/");
  Navigation extension(&fresh, "chrome-extension://fajbdaomknpkicfjcpipdmcpoamdmilh/ardia-linux-bridge.html");
  Navigation blank(&fresh, "about:blank");
  assert(page.deferred() && in_private.deferred());
  assert(!shell.deferred() && !extension.deferred() && !blank.deferred());
  Navigation elsewhere(&existing, "https://ads.test/");
  assert(!elsewhere.deferred());

  Bridges()[&fresh].mode = FakeBridge::Mode::kNotReady;
  base::RunTasks();
  fresh.system.ready_event.Signal();
  Advance(2000);
  assert(ardia::LinuxNavigationsHeld(&fresh) && page.resumed() == 0);
  Bridges()[&fresh].mode = FakeBridge::Mode::kAnswer;
  Advance(500);
  assert(!ardia::LinuxNavigationsHeld(&fresh));
  assert(Has(Bridges()[&fresh].ops, "settings"));
  assert(page.resumed() == 1 && in_private.resumed() == 1);
  Navigation after(&fresh, "https://ads.test/");
  assert(after.registry.throttles.empty());
  Advance(31000);

  Profile slow("/profiles/Slow");
  slow.new_profile = true;
  ardia::StartLinuxContentBlocker(&slow, &slow);
  Navigation waiting(&slow, "https://ads.test/");
  assert(waiting.deferred());
  base::RunTasks();
  Advance(9900);
  assert(ardia::LinuxNavigationsHeld(&slow) && waiting.resumed() == 0);
  Advance(200);
  assert(!ardia::LinuxNavigationsHeld(&slow) && waiting.resumed() == 1);

  base::FakeExeDir() = base::FilePath((scratch / "empty").string());
  Profile missing("/profiles/MissingHold");
  missing.new_profile = true;
  ardia::StartLinuxContentBlocker(&missing, &missing);
  Navigation not_installed(&missing, "https://ads.test/");
  assert(not_installed.deferred());
  base::RunTasks();
  base::RunTasks();
  assert(!ardia::LinuxNavigationsHeld(&missing) && not_installed.resumed() == 1);

  auto gone = std::make_unique<Profile>("/profiles/GoneHold");
  gone->new_profile = true;
  MakeBlocker(scratch / "hold");
  base::FakeExeDir() = base::FilePath((scratch / "hold").string());
  ardia::StartLinuxContentBlocker(gone.get(), gone.get());
  assert(ardia::LinuxNavigationsHeld(gone.get()));
  gone.reset();
  base::RunTasks();
  Advance(10500);
}

void IsolatedProfilesFollowTheDefault(const std::filesystem::path& scratch) {
  MakeBlocker(scratch / "follow");
  base::FakeExeDir() = base::FilePath((scratch / "follow").string());
  Profile lead("/profiles/Lead");
  Profile iso("/profiles/Iso");
  Profile iso_private("/profiles/Iso", true, &iso);
  FakeBridge& leader = Bridges()[&lead];
  leader.lists["fanboy-cookiemonster"] = true;
  leader.lists["easyprivacy"] = false;
  leader.whitelist = {"chrome-extension-scheme", "news.example"};
  leader.auto_update = false;
  FakeBridge& follower = Bridges()[&iso];

  ardia::StartLinuxContentBlocker(&lead, &iso_private);
  assert(!ardia::LinuxNavigationsHeld(&iso));
  auto before = Settle(Call(&lead, "contentBlocker.state", "{}", "iso", &iso), 200);
  assert(before->ok && *Dict(before).FindDict("stats")->FindString("error") == "the content blocker isn't available in this profile yet");

  Profile fresh_iso("/profiles/FreshIso");
  fresh_iso.new_profile = true;
  FakeBridge& fresh_follower = Bridges()[&fresh_iso];
  ardia::StartLinuxContentBlocker(&lead, &iso);
  ardia::StartLinuxContentBlocker(&lead, &fresh_iso);
  assert(ardia::LinuxNavigationsHeld(&iso) && ardia::LinuxNavigationsHeld(&fresh_iso) && !ardia::LinuxNavigationsHeld(&lead));
  Navigation held(&iso, "https://ads.test/");
  Navigation fresh_held(&fresh_iso, "https://ads.test/");
  assert(held.deferred() && fresh_held.deferred());
  base::RunTasks();
  iso.system.ready_event.Signal();
  fresh_iso.system.ready_event.Signal();
  Advance(1000);
  assert(!ardia::LinuxNavigationsHeld(&iso) && held.resumed() == 1);
  assert(Has(follower.ops, "settings") && !Has(follower.ops, "follow"));
  assert(ardia::LinuxNavigationsHeld(&fresh_iso) && fresh_held.resumed() == 0);
  lead.system.ready_event.Signal();
  Advance(1000);
  assert(!ardia::LinuxNavigationsHeld(&fresh_iso) && fresh_held.resumed() == 1);
  assert(fresh_follower.lists == leader.lists && Has(fresh_follower.whitelist, "news.example"));
  assert(iso.loader.added.size() == 1);
  assert(follower.lists == leader.lists && !follower.auto_update);
  assert(Has(follower.whitelist, "news.example") && Has(follower.whitelist, "chrome-extension-scheme"));
  assert(!Has(leader.ops, "follow") && Has(follower.ops, "follow"));

  Events().clear();
  auto allow = Settle(Call(&lead, "contentBlocker.setAllowed", R"({"host":"shop.example","allowed":true})", "iso", &iso));
  assert(allow->ok);
  Advance(1000);
  assert(Has(leader.whitelist, "shop.example") && Has(follower.whitelist, "shop.example"));
  assert(Events().size() == 1);
  auto state = Settle(Call(&lead, "contentBlocker.state", "{}", "iso", &iso));
  assert(Dict(state).FindDict("stats")->Find("ready")->GetBool());
  auto from_private = Settle(Call(&lead, "contentBlocker.isAllowed", R"({"host":"a.shop.example"})", "incognito:i@iso", &iso_private));
  assert(from_private->ok && from_private->value.GetBool());
  assert(Settle(Call(&lead, "contentBlocker.setListEnabled", R"({"id":"easyprivacy","enabled":true})", "iso", &iso))->ok);
  Advance(1000);
  assert(follower.lists["easyprivacy"]);
  assert(Settle(Call(&lead, "contentBlocker.setEnabled", R"({"enabled":true})"))->ok);
  Advance(1000);
  assert(follower.auto_update && leader.auto_update);

  Profile retry("/profiles/Retry");
  FakeBridge& retrying = Bridges()[&retry];
  retrying.fail_follows = 2;
  ardia::StartLinuxContentBlocker(&lead, &retry);
  Navigation queued(&retry, "https://ads.test/");
  base::RunTasks();
  retry.system.ready_event.Signal();
  Advance(500);
  assert(!ardia::LinuxNavigationsHeld(&retry) && queued.resumed() == 1);
  assert(!Has(retrying.whitelist, "shop.example"));
  Advance(1100);
  assert(!Has(retrying.whitelist, "shop.example") && retrying.fail_follows == 0);
  Advance(2100);
  assert(Has(retrying.whitelist, "shop.example") && retrying.lists == leader.lists);

  Profile stuck("/profiles/Stuck");
  Bridges()[&stuck].fail_follows = 100;
  ardia::StartLinuxContentBlocker(&lead, &stuck);
  base::RunTasks();
  stuck.system.ready_event.Signal();
  Advance(40000);
  const int attempts = 100 - Bridges()[&stuck].fail_follows;
  assert(attempts == 6);
  Advance(40000);
  assert(100 - Bridges()[&stuck].fail_follows == 6);

  auto short_lead = std::make_unique<Profile>("/profiles/ShortLead");
  Profile orphan("/profiles/Orphan");
  Bridges()[short_lead.get()];
  Bridges()[&orphan].fail_follows = 1;
  ardia::StartLinuxContentBlocker(short_lead.get(), &orphan);
  base::RunTasks();
  short_lead->system.ready_event.Signal();
  orphan.system.ready_event.Signal();
  Advance(500);
  assert(Bridges()[&orphan].fail_follows == 0 && !ardia::LinuxNavigationsHeld(&orphan));
  const auto follows = [&] { return std::count(Bridges()[&orphan].ops.begin(), Bridges()[&orphan].ops.end(), "follow"); };
  assert(follows() == 1);
  short_lead.reset();
  Advance(40000);
  assert(follows() == 1);
  auto orphan_state = Settle(Call(&lead, "contentBlocker.state", "{}", "orphan", &orphan));
  assert(orphan_state->ok);

  auto leaving = std::make_unique<Profile>("/profiles/Leaving");
  Bridges()[leaving.get()].fail_follows = 1;
  ardia::StartLinuxContentBlocker(&lead, leaving.get());
  base::RunTasks();
  leaving->system.ready_event.Signal();
  Advance(300);
  leaving.reset();
  Advance(5000);
}

void DestroyedBeforeLoad(const std::filesystem::path& scratch) {
  MakeBlocker(scratch / "early");
  base::FakeExeDir() = base::FilePath((scratch / "early").string());
  auto profile = std::make_unique<Profile>("/profiles/Early");
  auto pending = Call(profile.get(), "contentBlocker.setEnabled", R"({"enabled":true})");
  profile.reset();
  base::RunTasks();
  assert(pending->done && pending->code == "ERR_CONTENT_BLOCKER_UNAVAILABLE" && pending->message == "profile gone");
}

}

int main() {
  const auto scratch = std::filesystem::temp_directory_path() / ("ardia-site-controls-" + std::to_string(::getpid()));
  std::filesystem::create_directories(scratch / "empty");
  ardia::StartLinuxSiteControls(ardia::ContentBlockerChanged([](Profile*, base::Value stats) { Events().push_back(std::move(stats)); }));
  Profile profile("/profiles/Default");
  Profile incognito("/profiles/Default", true, &profile);
  Profile work("/profiles/Work");
  Profile otr("/profiles/Default", true, &profile);
  Registry()["default"] = &profile;
  Registry()["work"] = &work;
  Registry()["otr"] = &otr;
  SitePermissionsThroughTheService(profile, incognito);
  PrivateSessionThroughTheService(profile, incognito);
  BrowsingDataThroughTheService(profile, incognito);
  MissingBlocker(scratch);
  WrongComponent(scratch);
  ComponentNotEnabled(scratch);
  QueuedBeforeLoadExpires(scratch);
  OtherPageProfiles(profile, work, incognito);
  WorkingBlocker(scratch);
  DestroyedBeforeLoad(scratch);
  HoldsFirstLaunchNavigationsUntilReady(scratch);
  IsolatedProfilesFollowTheDefault(scratch);
  std::filesystem::remove_all(scratch);
  std::puts("site controls service scenarios passed");
}
