#include "ardia/linux/ac_linux_site_controls.h"

#include <cassert>
#include <cstdio>
#include <initializer_list>
#include <limits>
#include <map>
#include <set>
#include <string>
#include <utility>
#include <variant>
#include <vector>

using namespace linux_site_controls;

namespace {

const Failure* AsFailure(const std::variant<ServiceRequest, Failure>& result) { return std::get_if<Failure>(&result); }
const Failure* AsFailure(const std::variant<BlockerRequest, Failure>& result) { return std::get_if<Failure>(&result); }
const Failure* AsFailure(const std::variant<base::Value, Failure>& result) { return std::get_if<Failure>(&result); }

std::string Code(const std::variant<ServiceRequest, Failure>& result) {
  const Failure* failure = AsFailure(result);
  return failure ? failure->code : std::string();
}

std::string Text(const base::DictValue& dict, std::string_view key) {
  const std::string* value = dict.FindString(key);
  return value ? *value : std::string();
}

bool BoolOf(const base::DictValue& dict, std::string_view key) {
  const base::Value* value = dict.Find(key);
  assert(value && value->is_bool());
  return value->GetBool();
}

double NumberOf(const base::DictValue& dict, std::string_view key) {
  const base::Value* value = dict.Find(key);
  assert(value && (value->is_int() || value->is_double()));
  return value->GetDouble();
}

base::ListValue Strings(std::initializer_list<const char*> values) {
  base::ListValue list;
  for (const char* value : values) list.Append(base::Value(value));
  return list;
}

class FakeSiteEngine {
 public:
  base::Value Run(const ServiceRequest& request) {
    const std::string origin = Text(request.args, "origin");
    if (request.service == "ac_site_settings_get") {
      base::DictValue settings;
      for (const char* type : {"camera", "location", "notifications"}) {
        auto found = exceptions_.find({origin, type});
        const bool custom = found != exceptions_.end();
        settings.Set(type, base::DictValue()
                               .Set("value", custom ? found->second : std::string(type == std::string("notifications") ? "ask" : "ask"))
                               .Set("isDefault", base::Value(!custom)));
      }
      settings.Set("futureType", base::DictValue().Set("value", "allow").Set("isDefault", base::Value(true)));
      return base::Value(base::DictValue().Set("settings", std::move(settings)));
    }
    if (request.service == "ac_site_settings_set") {
      const std::string value = Text(request.args, "value");
      if (value == "default") exceptions_.erase({origin, Text(request.args, "type")});
      else exceptions_[{origin, Text(request.args, "type")}] = value;
      return base::Value(base::DictValue());
    }
    if (request.service == "ac_site_settings_reset") {
      for (auto it = exceptions_.begin(); it != exceptions_.end();) it = it->first.first == origin ? exceptions_.erase(it) : std::next(it);
      return base::Value(base::DictValue());
    }
    if (request.service == "ac_site_settings_origins") {
      std::set<std::string> origins;
      for (const auto& [key, value] : exceptions_) origins.insert(key.first);
      base::ListValue list;
      for (const auto& o : origins) list.Append(base::Value(o));
      list.Append(base::Value("chrome://settings"));
      list.Append(base::Value(7));
      return base::Value(base::DictValue().Set("origins", base::Value(std::move(list))));
    }
    return base::Value(base::DictValue().Set("error", "unknown service"));
  }

 private:
  std::map<std::pair<std::string, std::string>, std::string> exceptions_;
};

base::Value RoundTrip(FakeSiteEngine& engine, std::string_view name, base::DictValue args) {
  auto prepared = PrepareServiceCall(name, args);
  assert(!AsFailure(prepared));
  base::Value reply = engine.Run(std::get<ServiceRequest>(prepared));
  auto completed = CompleteServiceCall(name, reply);
  assert(!AsFailure(completed));
  return std::move(std::get<base::Value>(completed));
}

void HandlesAndProfiles() {
  for (const char* name : {"sites.settings", "sites.setSetting", "sites.origins", "sites.reset", "sites.clearData",
                           "profiles.clearBrowsingData", "contentBlocker.state", "contentBlocker.setEnabled",
                           "contentBlocker.setListEnabled", "contentBlocker.isAllowed", "contentBlocker.setAllowed",
                           "contentBlocker.devFailNextMessage", "contentBlocker.devDelayNextLoad"}) {
    assert(Handles(name));
  }
  for (const char* name : {"sites.zoomLevels", "sites.setZoom", "profiles.deleteData", "profiles.release",
                           "contentBlocker", "downloads.list", "sites.settings.extra"}) {
    assert(!Handles(name));
  }
  assert(IsContentBlockerCall("contentBlocker.state") && !IsContentBlockerCall("sites.settings"));
  const auto capabilities = Capabilities();
  assert(capabilities.size() == 12);
  for (const auto name : capabilities) assert(Handles(name) && name != "contentBlocker.devDelayNextLoad");
  auto route = [](std::string_view name, std::string_view requested) { return RouteProfile(name, requested, false); };
  auto from_private = [](std::string_view name, std::string_view requested) { return RouteProfile(name, requested, true); };
  for (const char* requested : {"", "default", "work", "incognito:w@default"}) {
    for (const char* served : {"sites.settings", "sites.setSetting", "sites.origins", "sites.reset", "sites.clearData"}) {
      assert(std::get<ProfileRoute>(from_private(served, requested)) == ProfileRoute::kPrivate);
    }
    assert(std::get<Failure>(from_private("profiles.clearBrowsingData", requested)).code == "ERR_PROFILE_PRIVATE");
    assert(std::get<ProfileRoute>(from_private("contentBlocker.state", requested)) == ProfileRoute::kApp);
  }
  assert(std::get<ProfileRoute>(route("sites.settings", "")) == ProfileRoute::kRegistry);
  assert(std::get<ProfileRoute>(route("sites.settings", "default")) == ProfileRoute::kRegistry);
  assert(std::get<ProfileRoute>(route("sites.origins", "work")) == ProfileRoute::kRegistry);
  for (const char* served : {"sites.settings", "sites.setSetting", "sites.origins", "sites.reset", "sites.clearData"}) {
    assert(std::get<ProfileRoute>(route(served, "incognito:w@default")) == ProfileRoute::kPrivate);
  }
  assert(std::get<Failure>(route("profiles.clearBrowsingData", "incognito:w@work")).code == "ERR_PROFILE_PRIVATE");
  assert(std::get<ProfileRoute>(route("contentBlocker.setAllowed", "incognito:w@default")) == ProfileRoute::kApp);
  assert(std::get<ProfileRoute>(route("contentBlocker.state", "work")) == ProfileRoute::kApp);
  const auto allow = base::DictValue().Set("host", "a.test").Set("allowed", base::Value(true));
  assert(PrivateBlockerRefusal("contentBlocker.setAllowed", allow, true)->code == "ERR_PROFILE_PRIVATE");
  assert(PrivateBlockerRefusal("contentBlocker.setEnabled", base::DictValue().Set("enabled", base::Value(false)), true));
  assert(!PrivateBlockerRefusal("contentBlocker.setAllowed", allow, false));
  assert(!PrivateBlockerRefusal("contentBlocker.isAllowed", base::DictValue().Set("host", "a.test"), true));
  assert(!PrivateBlockerRefusal("contentBlocker.state", base::DictValue(), true));
  assert(!PrivateBlockerRefusal("sites.setSetting", allow, true));
}

void Origins() {
  for (const char* good : {"https://example.com", "http://example.com:8080", "https://a.b-c.d_e.test", "http://127.0.0.1",
                           "https://[::1]", "https://[2001:db8::1]:8443", "http://localhost"}) {
    assert(ValidOrigin(good));
  }
  for (const char* bad : {"", "null", "example.com", "ftp://example.com", "https://", "https://example.com/",
                          "https://example.com/path", "https://Example.com", "https://ex ample.com", "https://a..b",
                          "https://.a", "https://a.", "https://a:0", "https://a:65536", "https://a:080", "https://a:",
                          "https://user@a", "https://[::1", "https://[zz::1]", "https://a#x", "https://a?x",
                          "chrome://settings", "javascript:alert(1)", "https://a\x01b"}) {
    assert(!ValidOrigin(bad));
  }
  assert(!ValidOrigin("https://" + std::string(64, 'a') + ".test"));
  assert(ValidOrigin("https://" + std::string(63, 'a') + ".test"));
}

void SitePermissionRoundTrip() {
  FakeSiteEngine engine;
  const char* origin = "https://camera.ardia.test";
  base::Value initial = RoundTrip(engine, "sites.settings", base::DictValue().Set("origin", origin).Set("engine", "chromium"));
  const base::DictValue& before = initial.GetDict();
  assert(Text(*before.FindDict("camera"), "value") == "ask" && BoolOf(*before.FindDict("camera"), "isDefault"));
  assert(!before.Find("futureType"));
  assert(RoundTrip(engine, "sites.setSetting", base::DictValue().Set("origin", origin).Set("type", "camera").Set("value", "allow").Set("engine", "chromium")).is_none());
  assert(RoundTrip(engine, "sites.setSetting", base::DictValue().Set("origin", origin).Set("type", "location").Set("value", "block")).is_none());
  base::Value granted = RoundTrip(engine, "sites.settings", base::DictValue().Set("origin", origin));
  assert(Text(*granted.GetDict().FindDict("camera"), "value") == "allow");
  assert(!BoolOf(*granted.GetDict().FindDict("camera"), "isDefault"));
  assert(Text(*granted.GetDict().FindDict("location"), "value") == "block");
  base::Value origins = RoundTrip(engine, "sites.origins", base::DictValue());
  assert(origins.is_list() && origins.GetList().size() == 1 && origins.GetList()[0].GetString() == origin);
  assert(RoundTrip(engine, "sites.setSetting", base::DictValue().Set("origin", origin).Set("type", "camera").Set("value", "default")).is_none());
  base::Value revoked = RoundTrip(engine, "sites.settings", base::DictValue().Set("origin", origin));
  assert(BoolOf(*revoked.GetDict().FindDict("camera"), "isDefault"));
  assert(!BoolOf(*revoked.GetDict().FindDict("location"), "isDefault"));
  assert(RoundTrip(engine, "sites.reset", base::DictValue().Set("origin", origin)).is_none());
  base::Value reset = RoundTrip(engine, "sites.settings", base::DictValue().Set("origin", origin));
  assert(BoolOf(*reset.GetDict().FindDict("location"), "isDefault"));
  assert(RoundTrip(engine, "sites.origins", base::DictValue()).GetList().size() == 0);
}

void ServiceValidation() {
  auto settings = PrepareServiceCall("sites.settings", base::DictValue().Set("origin", "https://a.test"));
  assert(std::get<ServiceRequest>(settings).service == "ac_site_settings_get");
  assert(std::get<ServiceRequest>(settings).args.size() == 1);
  assert(Code(PrepareServiceCall("sites.settings", base::DictValue().Set("origin", "https://a.test").Set("engine", "webkit"))) == "ERR_UNKNOWN_CALL");
  assert(Code(PrepareServiceCall("sites.settings", base::DictValue().Set("origin", "https://a.test").Set("engine", base::Value(1)))) == "ERR_SITE_REQUEST");
  assert(Code(PrepareServiceCall("sites.settings", base::DictValue().Set("origin", "https://a.test").Set("tab", base::Value(3)))) == "ERR_SITE_REQUEST");
  assert(Code(PrepareServiceCall("sites.settings", base::DictValue())) == "ERR_SITE_REQUEST");
  assert(Code(PrepareServiceCall("sites.setSetting", base::DictValue().Set("origin", "https://a.test").Set("type", "camera").Set("value", "maybe"))) == "ERR_SITE_REQUEST");
  assert(Code(PrepareServiceCall("sites.setSetting", base::DictValue().Set("origin", "https://a.test").Set("type", "geolocation").Set("value", "allow"))) == "ERR_SITE_REQUEST");
  assert(Code(PrepareServiceCall("sites.setSetting", base::DictValue().Set("origin", "file:///etc").Set("type", "camera").Set("value", "allow"))) == "ERR_SITE_REQUEST");
  assert(Code(PrepareServiceCall("sites.origins", base::DictValue().Set("origin", "https://a.test"))) == "ERR_SITE_REQUEST");
  assert(std::get<ServiceRequest>(PrepareServiceCall("sites.reset", base::DictValue().Set("origin", "https://a.test"))).service == "ac_site_settings_reset");
  assert(std::get<ServiceRequest>(PrepareServiceCall("sites.clearData", base::DictValue().Set("origin", "http://a.test:81"))).service == "ac_site_data_clear");
  assert(std::get<ServiceRequest>(PrepareServiceCall("sites.clearData", base::DictValue().Set("origin", "https://a.test").Set("engine", "chromium"))).args.size() == 1);
  assert(Code(PrepareServiceCall("sites.clearData", base::DictValue().Set("origin", "https://a.test").Set("engine", "webkit"))) == "ERR_UNKNOWN_CALL");
  assert(Code(PrepareServiceCall("sites.reset", base::DictValue().Set("origin", "https://a.test").Set("engine", "chromium"))) == "ERR_SITE_REQUEST");
  assert(Code(PrepareServiceCall("sites.zoomLevels", base::DictValue())) == "ERR_UNKNOWN_CALL");

  auto error = CompleteServiceCall("sites.settings", base::Value(base::DictValue().Set("error", "origin must be an http(s) origin")));
  assert(AsFailure(error)->code == "ERR_ENGINE" && AsFailure(error)->message == "origin must be an http(s) origin");
  auto ending = CompleteServiceCall("sites.settings", base::Value(base::DictValue().Set("error", "no private session")));
  assert(AsFailure(ending)->code == "ERR_PROFILE_ENDING");
  auto refused = CompleteServiceCall("sites.origins", base::Value(base::DictValue().Set("error", "no engine data for a private profile")));
  assert(AsFailure(refused)->code == "ERR_PROFILE_PRIVATE");
  assert(AsFailure(CompleteServiceCall("sites.settings", base::Value("x")))->code == "ERR_BAD_REPLY");
  assert(AsFailure(CompleteServiceCall("sites.settings", base::Value(base::DictValue())))->code == "ERR_BAD_REPLY");
  base::DictValue malformed;
  malformed.Set("settings", base::DictValue().Set("camera", base::DictValue().Set("value", "sometimes").Set("isDefault", base::Value(true))));
  assert(AsFailure(CompleteServiceCall("sites.settings", base::Value(std::move(malformed))))->code == "ERR_BAD_REPLY");
  auto cleared = CompleteServiceCall("sites.clearData", base::Value(base::DictValue().Set("cookies", base::Value(3)).Set("storage", base::Value(true))));
  assert(NumberOf(std::get<base::Value>(cleared).GetDict(), "cookies") == 3 && BoolOf(std::get<base::Value>(cleared).GetDict(), "storage"));
  auto invalid_site = CompleteServiceCall("sites.clearData", base::Value(base::DictValue().Set("cookies", base::Value(false)).Set("storage", base::Value(false))));
  assert(!BoolOf(std::get<base::Value>(invalid_site).GetDict(), "storage"));
  assert(AsFailure(CompleteServiceCall("sites.clearData", base::Value(base::DictValue().Set("cookies", base::Value(true)).Set("storage", base::Value(true)))))->code == "ERR_BAD_REPLY");
}

void BrowsingDataScope() {
  auto all = PrepareServiceCall("profiles.clearBrowsingData", base::DictValue()
      .Set("types", base::Value(Strings({"history", "siteData", "cache", "downloads"}))).Set("since", base::Value()));
  const ServiceRequest& request = std::get<ServiceRequest>(all);
  assert(request.service == "ac_browsing_data_clear");
  assert(request.args.Find("types")->GetList().size() == 4 && !request.args.Find("since"));
  auto hour = PrepareServiceCall("profiles.clearBrowsingData", base::DictValue()
      .Set("types", base::Value(Strings({"cache"}))).Set("since", base::Value(1761500000000.0)));
  const ServiceRequest& scoped = std::get<ServiceRequest>(hour);
  assert(scoped.args.Find("types")->GetList().size() == 1 && scoped.args.Find("types")->GetList()[0].GetString() == "cache");
  assert(NumberOf(scoped.args, "since") == 1761500000000.0);
  auto zero = PrepareServiceCall("profiles.clearBrowsingData", base::DictValue().Set("types", base::Value(Strings({"history"}))).Set("since", base::Value(0)));
  assert(!std::get<ServiceRequest>(zero).args.Find("since"));
  auto omitted = PrepareServiceCall("profiles.clearBrowsingData", base::DictValue().Set("types", base::Value(Strings({"history"}))));
  assert(!AsFailure(omitted));
  for (auto& bad : {Strings({}), Strings({"formData"}), Strings({"siteSettings"}), Strings({"cache", "cache"}),
                    Strings({"history", "siteData", "cache", "downloads", "history"})}) {
    assert(Code(PrepareServiceCall("profiles.clearBrowsingData", base::DictValue().Set("types", base::Value(bad.Clone())))) == "ERR_SITE_REQUEST");
  }
  assert(Code(PrepareServiceCall("profiles.clearBrowsingData", base::DictValue().Set("types", base::Value("history")))) == "ERR_SITE_REQUEST");
  for (double since : {-1.0, 1e300, std::numeric_limits<double>::infinity(), std::numeric_limits<double>::quiet_NaN()}) {
    assert(Code(PrepareServiceCall("profiles.clearBrowsingData", base::DictValue().Set("types", base::Value(Strings({"cache"}))).Set("since", base::Value(since)))) == "ERR_SITE_REQUEST");
  }
  assert(Code(PrepareServiceCall("profiles.clearBrowsingData", base::DictValue().Set("types", base::Value(Strings({"cache"}))).Set("since", "yesterday"))) == "ERR_SITE_REQUEST");
  assert(Code(PrepareServiceCall("profiles.clearBrowsingData", base::DictValue().Set("types", base::Value(Strings({"cache"}))).Set("origin", "https://a.test"))) == "ERR_SITE_REQUEST");
  assert(std::get<base::Value>(CompleteServiceCall("profiles.clearBrowsingData", base::Value(base::DictValue().Set("ok", base::Value(true))))).is_none());
  assert(AsFailure(CompleteServiceCall("profiles.clearBrowsingData", base::Value(base::DictValue().Set("ok", base::Value(false)))))->code == "ERR_CLEAR_INCOMPLETE");
  assert(AsFailure(CompleteServiceCall("profiles.clearBrowsingData", base::Value(base::DictValue())))->code == "ERR_BAD_REPLY");
  assert(AsFailure(CompleteServiceCall("profiles.clearBrowsingData", base::Value(base::DictValue().Set("error", "types required"))))->code == "ERR_ENGINE");
}

void BlockerRequests() {
  auto state = PrepareBlockerCall("contentBlocker.state", base::DictValue());
  assert(std::get<BlockerRequest>(state).op == BlockerOp::kState);
  assert(AsFailure(PrepareBlockerCall("contentBlocker.state", base::DictValue().Set("profile", "x")))->code == "ERR_CONTENT_BLOCKER_REQUEST");
  auto enabled = PrepareBlockerCall("contentBlocker.setEnabled", base::DictValue().Set("enabled", base::Value(false)));
  assert(std::get<BlockerRequest>(enabled).op == BlockerOp::kSetEnabled && !std::get<BlockerRequest>(enabled).flag);
  assert(AsFailure(PrepareBlockerCall("contentBlocker.setEnabled", base::DictValue().Set("enabled", base::Value(1)))));
  auto list = PrepareBlockerCall("contentBlocker.setListEnabled", base::DictValue().Set("id", "easylist").Set("enabled", base::Value(true)));
  assert(std::get<BlockerRequest>(list).id == "easylist" && std::get<BlockerRequest>(list).flag);
  for (const char* id : {"", "../x", "a b", "a'b", "a\"b", "a/b", "a\\b"}) {
    assert(AsFailure(PrepareBlockerCall("contentBlocker.setListEnabled", base::DictValue().Set("id", id).Set("enabled", base::Value(true)))));
  }
  assert(AsFailure(PrepareBlockerCall("contentBlocker.setListEnabled", base::DictValue().Set("id", std::string(129, 'a')).Set("enabled", base::Value(true)))));
  auto allowed = PrepareBlockerCall("contentBlocker.setAllowed", base::DictValue().Set("host", "News.Example.COM").Set("allowed", base::Value(true)));
  assert(std::get<BlockerRequest>(allowed).host == "news.example.com" && std::get<BlockerRequest>(allowed).flag);
  auto ask = PrepareBlockerCall("contentBlocker.isAllowed", base::DictValue().Set("host", "example.com"));
  assert(std::get<BlockerRequest>(ask).op == BlockerOp::kIsAllowed);
  assert(AsFailure(PrepareBlockerCall("contentBlocker.isAllowed", base::DictValue().Set("host", "example.com").Set("allowed", base::Value(true)))));
  for (const char* host : {"", "/^(?:ardia-blocking-off|)/", "example.com/path", "#comment", "*", "a b", "https://a.test", "a..b"}) {
    assert(AsFailure(PrepareBlockerCall("contentBlocker.setAllowed", base::DictValue().Set("host", host).Set("allowed", base::Value(true)))));
  }
  assert(AsFailure(PrepareBlockerCall("contentBlocker.setAllowed", base::DictValue().Set("host", "a.test"))));
  assert(std::get<BlockerRequest>(PrepareBlockerCall("contentBlocker.devFailNextMessage", base::DictValue())).op == BlockerOp::kFailNext);
  assert(AsFailure(PrepareBlockerCall("contentBlocker.devDelayNextLoad", base::DictValue().Set("ms", base::Value(5))))->code == kUnavailableCode);
  assert(Mutates(BlockerOp::kSetAllowed) && Mutates(BlockerOp::kSetList) && Mutates(BlockerOp::kSetEnabled));
  assert(!Mutates(BlockerOp::kState) && !Mutates(BlockerOp::kIsAllowed) && !Mutates(BlockerOp::kFailNext));
}

void BlockerStates() {
  assert(Category("easylist", "ads") == "ads");
  assert(Category("ublock-privacy", "") == "trackers");
  assert(Category("easyprivacy", "privacy") == "trackers");
  assert(Category("fanboy-cookiemonster", "annoyances") == "cookies");
  assert(Category("ublock-badware", "") == "security");
  assert(Category("urlhaus-1", "malware") == "security");
  assert(Category("DEU-0", "regions") == "regional");
  assert(Category("fanboy-social", "social") == "annoyances");

  base::ListValue lists;
  lists.Append(base::Value(base::DictValue().Set("id", "easylist").Set("title", "EasyList").Set("group", "ads")
      .Set("enabled", base::Value(true)).Set("defaultOn", base::Value(true)).Set("filters", base::Value(52000))));
  lists.Append(base::Value(base::DictValue().Set("id", "easylist").Set("title", "Duplicate")));
  lists.Append(base::Value(base::DictValue().Set("id", "fanboy-cookiemonster").Set("title", "").Set("group", "annoyances")
      .Set("enabled", base::Value(false)).Set("defaultOn", base::Value(false)).Set("filters", base::Value(-4))));
  lists.Append(base::Value(base::DictValue().Set("id", "bad id").Set("title", "x")));
  lists.Append(base::Value(7));
  base::DictValue read;
  read.Set("lists", base::Value(std::move(lists)));
  read.Set("allowedHosts", base::Value(Strings({"Example.com", "example.com", "a/b", "#x", "news.test"})));
  read.Set("enabled", base::Value(true));
  read.Set("networkFilters", base::Value(1234.0));
  read.Set("cosmeticFilters", base::Value(567));
  base::DictValue state = BlockerState(read, "1.75.0");
  assert(BoolOf(state, "enabled") && Text(state, "version") == "1.75.0");
  const base::ListValue& out = state.Find("lists")->GetList();
  assert(out.size() == 2);
  assert(Text(out[0].GetDict(), "category") == "ads" && NumberOf(out[0].GetDict(), "filters") == 52000);
  assert(Text(out[1].GetDict(), "title") == "fanboy-cookiemonster" && Text(out[1].GetDict(), "category") == "cookies");
  assert(NumberOf(out[1].GetDict(), "filters") == 0 && !BoolOf(out[1].GetDict(), "enabled"));
  const base::ListValue& hosts = state.Find("allowedHosts")->GetList();
  assert(hosts.size() == 2 && hosts[0].GetString() == "example.com" && hosts[1].GetString() == "news.test");
  const base::DictValue& stats = *state.FindDict("stats");
  assert(BoolOf(stats, "ready") && BoolOf(stats, "enabled") && NumberOf(stats, "networkFilters") == 1234 &&
         NumberOf(stats, "cosmeticFilters") == 567 && NumberOf(stats, "lookups") == 0);

  base::DictValue missing = UnavailableBlockerState("", "the content blocker is not installed");
  assert(!BoolOf(missing, "enabled") && missing.Find("lists")->GetList().size() == 0);
  assert(!BoolOf(*missing.FindDict("stats"), "ready"));
  assert(Text(*missing.FindDict("stats"), "error") == "the content blocker is not installed");
  assert(Text(*UnavailableBlockerState("", "").FindDict("stats"), "error") == "unavailable");
  assert(!BoolOf(*BlockerState(base::DictValue(), "").FindDict("stats"), "ready"));

  BlockerRequest state_request;
  const std::string error = "uBlock Origin never started";
  auto unavailable = CompleteBlockerCall(state_request, nullptr, &error, "1.75.0");
  assert(!AsFailure(unavailable) && !BoolOf(*std::get<base::Value>(unavailable).GetDict().FindDict("stats"), "ready"));
  BlockerRequest set;
  set.op = BlockerOp::kSetList;
  assert(AsFailure(CompleteBlockerCall(set, nullptr, &error, ""))->code == kUnavailableCode);
  base::Value null_value;
  assert(std::get<base::Value>(CompleteBlockerCall(set, &null_value, nullptr, "")).is_none());
  BlockerRequest ask;
  ask.op = BlockerOp::kIsAllowed;
  base::Value yes(true);
  assert(std::get<base::Value>(CompleteBlockerCall(ask, &yes, nullptr, "")).GetBool());
  assert(AsFailure(CompleteBlockerCall(ask, &null_value, nullptr, ""))->code == "ERR_BAD_REPLY");
  assert(AsFailure(CompleteBlockerCall(ask, nullptr, &error, ""))->code == kUnavailableCode);
  assert(ValidBundledVersion("1.75.0") && ValidBundledVersion("1.75.0.22"));
  assert(!ValidBundledVersion("") && !ValidBundledVersion("1.75<script>") && !ValidBundledVersion(std::string(33, '1')));
}

base::Value TextList(const std::vector<std::string>& items) {
  base::ListValue list;
  for (const std::string& item : items) list.Append(base::Value(item));
  return base::Value(std::move(list));
}

void FollowDefault() {
  for (const char* name : {"contentBlocker.settings", "contentBlocker.follow", "contentBlocker.followDefault"}) {
    assert(AsFailure(PrepareBlockerCall(name, base::DictValue())));
  }
  const std::string off = "/^(?:ardia-blocking-off|)/";
  base::Value read(base::DictValue()
                       .Set("lists", TextList({"easylist", "easyprivacy"}))
                       .Set("whitelist", TextList({"chrome-extension-scheme", "news.example", off}))
                       .Set("autoUpdate", base::Value(false)));
  std::optional<BlockerSettings> settings = ParseBlockerSettings(read);
  assert(settings);
  assert((settings->lists == std::vector<std::string>{"easylist", "easyprivacy"}));
  assert((settings->whitelist == std::vector<std::string>{"chrome-extension-scheme", "news.example", off}));
  assert(!settings->auto_update);

  BlockerRequest follow;
  follow.op = BlockerOp::kFollow;
  follow.settings = *settings;
  PendingCall call{.ticket = 7, .request = follow, .deadline_ms = 20000};
  base::DictValue request = BridgeRequest(call, 0);
  assert(Text(request, "op") == "follow");
  const base::DictValue* args = request.FindDict("args");
  assert(args && args->Find("lists") && args->Find("lists")->GetList().size() == 2);
  assert(args->Find("whitelist")->GetList().size() == 3 && !BoolOf(*args, "autoUpdate"));
  BlockerRequest read_request;
  read_request.op = BlockerOp::kSettings;
  assert(BridgeOpName(BlockerOp::kSettings) == "settings");
  assert(!Mutates(BlockerOp::kSettings) && !Mutates(BlockerOp::kFollow));

  auto completed = CompleteBlockerCall(read_request, &read, nullptr, "1.75.0");
  assert(!AsFailure(completed));
  assert(ParseBlockerSettings(std::get<base::Value>(completed)));
  base::Value imported(base::DictValue()
                           .Set("lists", TextList({"easylist", "https://example.com/filters.txt", "../x"}))
                           .Set("whitelist", TextList({"news.example"}))
                           .Set("autoUpdate", base::Value(true)));
  std::optional<BlockerSettings> kept = ParseBlockerSettings(imported);
  assert(kept && kept->lists == std::vector<std::string>{"easylist"});
  assert((kept->whitelist == std::vector<std::string>{"news.example"}));
  assert(!AsFailure(CompleteBlockerCall(read_request, &imported, nullptr, "1.75.0")));
  base::Value not_lists(base::DictValue().Set("lists", base::Value(3)).Set("whitelist", TextList({})).Set("autoUpdate", base::Value(true)));
  assert(AsFailure(CompleteBlockerCall(read_request, &not_lists, nullptr, "1.75.0")));
  const std::string failed = "uBlock Origin never started";
  assert(AsFailure(CompleteBlockerCall(read_request, nullptr, &failed, "1.75.0"))->code == kUnavailableCode);
  assert(!AsFailure(CompleteBlockerCall(follow, nullptr, nullptr, "1.75.0")));

  for (const std::string& directive : {std::string("a\nb"), std::string("a\rb"), std::string(1, '\0'), std::string(), std::string(2049, 'a')}) {
    base::Value with(base::DictValue().Set("lists", TextList({})).Set("whitelist", TextList({directive})).Set("autoUpdate", base::Value(true)));
    assert(!ParseBlockerSettings(with));
  }
  assert(!ParseBlockerSettings(base::Value(base::DictValue().Set("lists", TextList({})).Set("whitelist", TextList({})))));
  assert(!ParseBlockerSettings(base::Value(base::DictValue().Set("lists", base::Value(3)).Set("whitelist", TextList({})).Set("autoUpdate", base::Value(true)))));
  base::ListValue many;
  for (size_t i = 0; i <= kMaxFollowedDirectives; ++i) many.Append(base::Value("h" + std::to_string(i) + ".test"));
  assert(!ParseBlockerSettings(base::Value(base::DictValue().Set("lists", TextList({})).Set("whitelist", base::Value(std::move(many))).Set("autoUpdate", base::Value(true)))));
  base::ListValue mixed_list;
  mixed_list.Append(base::Value("ok.test"));
  mixed_list.Append(base::Value(4));
  assert(!ParseBlockerSettings(base::Value(base::DictValue().Set("lists", TextList({})).Set("whitelist", base::Value(std::move(mixed_list))).Set("autoUpdate", base::Value(true)))));
}

void NavigationHoldPolicy() {
  for (const char* scheme : {"http", "https", "ws", "wss", "file", "data", "blob", "ftp"}) assert(HoldsNavigationTo(scheme));
  for (const char* scheme : {"chrome-extension", "chrome", "chrome-untrusted", "devtools", "about"}) assert(!HoldsNavigationTo(scheme));
  assert(ShouldHoldNavigations(false, false));
  assert(ShouldHoldNavigations(false, true));
  assert(ShouldHoldNavigations(true, true));
  assert(!ShouldHoldNavigations(true, false));
  assert(HoldUntilFirstCopy(false, true));
  assert(!HoldUntilFirstCopy(false, false));
  assert(!HoldUntilFirstCopy(true, true) && !HoldUntilFirstCopy(true, false));
  assert(kHoldDeadlineMs == 10000);
  assert(kInheritAttempts == 6);
  int64_t total = 0;
  for (int attempt = 0; attempt + 1 < kInheritAttempts; ++attempt) {
    assert(InheritRetryDelayMs(attempt) == (int64_t{1000} << attempt));
    total += InheritRetryDelayMs(attempt);
  }
  assert(total == 31000);
}

void BridgeScripts() {
  const std::string send = SendScript("\"{\\\"ticket\\\":1}\"");
  assert(send.find("data-ardia-bridge") != std::string::npos);
  assert(send.find("root.setAttribute('data-ardia-request', \"{\\\"ticket\\\":1}\")") != std::string::npos);
  assert(send.find("'bridge not ready'") != std::string::npos && send.find("'sent'") != std::string::npos);
  assert(PollScript().find("getAttribute('data-ardia-reply')") != std::string::npos);
  PendingCall call;
  call.ticket = 9;
  call.request.op = BlockerOp::kSetAllowed;
  call.request.host = "example.com";
  call.request.flag = true;
  call.deadline_ms = 25000;
  call.fail_next = true;
  base::DictValue request = BridgeRequest(call, 10000);
  assert(NumberOf(request, "ticket") == 9 && Text(request, "op") == "setAllowed" && BoolOf(request, "failNext"));
  assert(NumberOf(request, "deadlineMs") == 15000);
  assert(Text(*request.FindDict("args"), "host") == "example.com" && BoolOf(*request.FindDict("args"), "allowed"));
  assert(NumberOf(BridgeRequest(call, 30000), "deadlineMs") == 0);
  call.deadline_ms = 90000;
  assert(NumberOf(BridgeRequest(call, 0), "deadlineMs") == BlockerQueue::kCallMs);

  assert(!ParseBridgeReply(base::Value("x"), 1));
  assert(!ParseBridgeReply(base::Value(base::DictValue().Set("ticket", base::Value(2)).Set("value", base::Value(true))), 1));
  auto value = ParseBridgeReply(base::Value(base::DictValue().Set("ticket", base::Value(1)).Set("value", base::Value(true))), 1);
  assert(value && !value->error && value->value.GetBool());
  auto failed = ParseBridgeReply(base::Value(base::DictValue().Set("ticket", base::Value(1)).Set("error", "getLists: no answer")), 1);
  assert(failed && *failed->error == "getLists: no answer");
  auto empty = ParseBridgeReply(base::Value(base::DictValue().Set("ticket", base::Value(1))), 1);
  assert(empty && *empty->error == "no answer");
  assert(*ParseBridgeReply(base::Value(base::DictValue().Set("ticket", base::Value(1)).Set("error", base::Value(3))), 1)->error == "no answer");
}

void Queue() {
  BlockerQueue queue;
  assert(queue.Next(0) == BlockerQueue::Step::kIdle);
  BlockerRequest state;
  const int first = *queue.Enqueue(state, 0);
  assert(queue.Next(0) == BlockerQueue::Step::kOpenPage);
  assert(queue.Next(0) == BlockerQueue::Step::kWait);
  queue.PageReady();
  assert(queue.Next(1) == BlockerQueue::Step::kSend);
  queue.Sent();
  assert(queue.Next(1) == BlockerQueue::Step::kWait);
  assert(!queue.Answer(BridgeReply{first + 1, std::nullopt, base::Value()}, 2));
  auto done = queue.Answer(BridgeReply{first, std::nullopt, base::Value(base::DictValue())}, 2);
  assert(done && !done->error && !done->retry && done->call.ticket == first && done->value.is_dict());
  assert(queue.size() == 0 && !queue.in_flight());
  assert(!queue.IdleFor(2 + BlockerQueue::kPageIdleMs - 1) && queue.IdleFor(2 + BlockerQueue::kPageIdleMs));

  const int second = *queue.Enqueue(state, 100);
  assert(queue.Next(100) == BlockerQueue::Step::kSend);
  queue.Sent();
  auto retry = queue.Answer(BridgeReply{second, std::string("getWhitelist: no reply"), base::Value()}, 150);
  assert(retry && retry->retry && retry->reset_page && queue.size() == 1 && !queue.page_ready());
  assert(queue.Current()->attempts_left == BlockerQueue::kAttempts - 1);
  assert(queue.Next(150 + BlockerQueue::kRetryMs - 1) == BlockerQueue::Step::kWait);
  assert(queue.Next(150 + BlockerQueue::kRetryMs) == BlockerQueue::Step::kOpenPage);
  queue.PageReady();
  assert(queue.Next(500) == BlockerQueue::Step::kSend);
  queue.Sent();
  auto gone = queue.PageGone("renderer gone", 600);
  assert(gone && gone->retry && queue.size() == 1);
  assert(queue.Next(600 + BlockerQueue::kRetryMs) == BlockerQueue::Step::kOpenPage);
  auto load_failed = queue.PageGone("closed: the bridge page didn't load", 1000);
  assert(load_failed && load_failed->retry);
  queue.PageReady();
  queue.Next(1100);
  queue.Sent();
  auto reloaded = queue.Answer(BridgeReply{second, std::string("Extension context invalidated."), base::Value()}, 1100);
  assert(reloaded && reloaded->retry && reloaded->reset_page && queue.size() == 1 && !queue.page_ready());
  assert(queue.Next(1100 + BlockerQueue::kRetryMs) == BlockerQueue::Step::kOpenPage);
  queue.PageReady();
  queue.Next(2000);
  queue.Sent();
  auto final_error = queue.Answer(BridgeReply{second, std::string("no list nope"), base::Value()}, 2100);
  assert(final_error && !final_error->retry && !final_error->reset_page && *final_error->error == "no list nope");
  assert(queue.size() == 0 && queue.page_ready());

  const int third = *queue.Enqueue(state, 5000);
  queue.Next(5000);
  queue.Sent();
  auto timed_out = queue.Answer(BridgeReply{third, std::string("the call: timed out"), base::Value()}, 6000);
  assert(timed_out && !timed_out->retry && timed_out->reset_page && !queue.page_ready());

  queue.Enqueue(state, 10000);
  assert(queue.Next(10000) == BlockerQueue::Step::kOpenPage);
  assert(!queue.Expired(10000 + BlockerQueue::kCallMs + BlockerQueue::kGraceMs));
  auto expired = queue.Expired(10001 + BlockerQueue::kCallMs + BlockerQueue::kGraceMs);
  assert(expired && *expired->error == "the call timed out" && expired->reset_page && queue.size() == 0);
  assert(!queue.page_opening());

  queue.Enqueue(state, 40000);
  queue.Next(40000);
  queue.PageReady();
  queue.Next(40000);
  queue.Sent();
  auto late = queue.Fail("closed", 40000 + BlockerQueue::kCallMs);
  assert(late && !late->retry && *late->error == "closed" && late->reset_page);

  BlockerQueue exhausted;
  const int exhaust = *exhausted.Enqueue(state, 0);
  int retries = 0;
  for (;;) {
    exhausted.PageReady();
    exhausted.Next(1000000);
    exhausted.Sent();
    auto outcome = exhausted.Answer(BridgeReply{exhaust, std::string("no reply"), base::Value()}, 10);
    if (!outcome->retry) break;
    ++retries;
  }
  assert(retries == BlockerQueue::kAttempts && exhausted.size() == 0);

  BlockerQueue dev;
  dev.FailNext();
  dev.Enqueue(state, 0);
  dev.Enqueue(state, 0);
  assert(dev.Current()->fail_next);
  dev.PageReady();
  dev.Next(0);
  dev.Sent();
  auto dev_failed = dev.Answer(BridgeReply{dev.Current()->ticket, std::string("getLists: failed (dev)"), base::Value()}, 1);
  assert(dev_failed && !dev_failed->retry && dev.size() == 1 && !dev.Current()->fail_next);

  BlockerQueue full;
  for (size_t i = 0; i < BlockerQueue::kMaxQueued; ++i) assert(full.Enqueue(state, 0));
  assert(!full.Enqueue(state, 0));
  assert(full.Drain().size() == BlockerQueue::kMaxQueued && full.size() == 0 && !full.in_flight());
  assert(!full.PageGone("closed", 0));
}

}

int main() {
  HandlesAndProfiles();
  Origins();
  SitePermissionRoundTrip();
  ServiceValidation();
  BrowsingDataScope();
  BlockerRequests();
  BlockerStates();
  BridgeScripts();
  Queue();
  FollowDefault();
  NavigationHoldPolicy();
  std::puts("site controls scenarios passed");
}
