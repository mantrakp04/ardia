#include <cassert>
#include <cstdio>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "ardia/core/ac_launch_switches.h"
#include "chrome/browser/ardia/ac_engine.h"
#include "chrome/browser/ardia/ac_reauth.h"
#include "chrome/browser/ardia/ac_reauth_linux.h"
#include "components/dbus/thread_linux/dbus_thread_linux.h"
#include "content/public/browser/browser_thread.h"

namespace {

using device_reauth::DeviceAuthSource;

struct Result {
  std::optional<bool> granted;
  int runs = 0;
};

base::OnceCallback<void(bool)> Into(Result& result) {
  return base::OnceCallback<void(bool)>([&result](bool granted) {
    result.granted = granted;
    ++result.runs;
  });
}

void Request(Profile& profile, Result& result, int64_t validity_ms = 60000) {
  ardia::Reauth(&profile, DeviceAuthSource::kPasswordManager, u"see passwords",
                base::Milliseconds(validity_ms), Into(result));
}

void Pump() {
  while (dbus_thread_linux::system_bus->runner.RunOne()) {
  }
}

dbus::SentCall Take(size_t index) {
  assert(index < dbus::sent_calls.size());
  return std::move(dbus::sent_calls[index]);
}

void Reply(dbus::SentCall& call, bool authorized, bool challenge,
           std::vector<std::pair<std::string, std::string>> details = {}) {
  dbus::Response response;
  dbus::Node result{dbus::Node::Kind::kStruct, false, 0, {}, {}};
  result.children.push_back({dbus::Node::Kind::kBool, authorized, 0, {}, {}});
  result.children.push_back({dbus::Node::Kind::kBool, challenge, 0, {}, {}});
  dbus::Node array{dbus::Node::Kind::kArray, false, 0, "{ss}", {}};
  for (auto& [key, value] : details) {
    dbus::Node entry{dbus::Node::Kind::kDictEntry, false, 0, {}, {}};
    entry.children.push_back({dbus::Node::Kind::kString, false, 0, key, {}});
    entry.children.push_back({dbus::Node::Kind::kString, false, 0, value, {}});
    array.children.push_back(std::move(entry));
  }
  result.children.push_back(std::move(array));
  response.body.push_back(std::move(result));
  std::move(call.reply).Run(&response, nullptr);
}

void Fail(dbus::SentCall& call, const std::string& name, const std::string& message = "") {
  dbus::ErrorResponse error;
  error.error_name = name;
  if (!message.empty()) error.body.push_back({dbus::Node::Kind::kString, false, 0, message, {}});
  std::move(call.reply).Run(nullptr, &error);
}

std::string LastResult() {
  assert(!ardia::emitted.empty());
  assert(ardia::emitted.back().topic == "reauth.requested");
  return ardia::emitted.back().values.at("result");
}

void Reset() {
  dbus::sent_calls.clear();
  ardia::emitted.clear();
  ardiacore::background_instance = false;
  dbus_thread_linux::system_bus = std::make_shared<dbus::Bus>();
  base::TimeTicks::now_ms += 3600000;
}

void ExpectCheck(const dbus::SentCall& call) {
  assert(call.service == "org.freedesktop.PolicyKit1");
  assert(call.path == "/org/freedesktop/PolicyKit1/Authority");
  assert(call.interface == "org.freedesktop.PolicyKit1.Authority");
  assert(call.member == "CheckAuthorization");
  assert(call.timeout_ms == 120000);
  assert(call.body.size() == 5);
  const dbus::Node& subject = call.body[0];
  assert(subject.kind == dbus::Node::Kind::kStruct);
  assert(subject.children[0].text == "system-bus-name");
  const dbus::Node& subject_details = subject.children[1];
  assert(subject_details.kind == dbus::Node::Kind::kArray && subject_details.text == "{sv}");
  assert(subject_details.children.size() == 1);
  assert(subject_details.children[0].children[0].text == "name");
  assert(subject_details.children[0].children[1].kind == dbus::Node::Kind::kVariantString);
  assert(subject_details.children[0].children[1].text == ":1.42");
  assert(call.body[1].text == "dev.ardia.linux.reauthenticate");
  assert(call.body[2].kind == dbus::Node::Kind::kArray && call.body[2].children.empty());
  assert(call.body[3].kind == dbus::Node::Kind::kUint32 && call.body[3].number == 1);
  assert(call.body[4].text.starts_with("ardia-reauth-") && call.body[4].text.size() > 13);
}

void ExpectCancel(const dbus::SentCall& call, const std::string& cancellation) {
  assert(call.member == "CancelCheckAuthorization");
  assert(call.body.size() == 1 && call.body[0].text == cancellation);
}

void BackgroundAndPrivateNeverPrompt() {
  Reset();
  Profile profile;
  ardiacore::background_instance = true;
  assert(!ardia::ReauthAvailable());
  Result result;
  Request(profile, result);
  Pump();
  assert(result.runs == 1 && result.granted == false);
  assert(dbus::sent_calls.empty());
  assert(LastResult() == "unavailable");

  Reset();
  assert(ardia::ReauthAvailable());
  Profile otr;
  otr.off_the_record = true;
  Result private_result;
  Request(otr, private_result);
  Pump();
  assert(private_result.granted == false && dbus::sent_calls.empty());
  assert(LastResult() == "unavailable");

  Result no_profile;
  ardia::Reauth(nullptr, DeviceAuthSource::kAutofill, u"card", base::TimeDelta(), Into(no_profile));
  assert(no_profile.granted == false && dbus::sent_calls.empty());
}

void GrantIsRememberedOnlyWithinValidity() {
  Reset();
  Profile profile;
  Result first;
  Request(profile, first);
  assert(!first.granted && dbus::sent_calls.empty());
  Pump();
  assert(dbus::sent_calls.size() == 1);
  dbus::SentCall check = Take(0);
  ExpectCheck(check);
  Reply(check, true, false);
  assert(first.runs == 1 && first.granted == true);
  assert(LastResult() == "granted");

  dbus::sent_calls.clear();
  base::TimeTicks::now_ms += 59000;
  Result cached;
  Request(profile, cached);
  assert(cached.granted == true && dbus::sent_calls.empty());
  assert(dbus_thread_linux::system_bus->runner.pending() == 0);

  Result immediate;
  ardia::Reauth(&profile, DeviceAuthSource::kPasswordManager, u"export", base::TimeDelta(), Into(immediate));
  assert(!immediate.granted);
  Pump();
  assert(dbus::sent_calls.size() == 1);
  dbus::SentCall export_check = Take(0);
  Reply(export_check, false, false);
  assert(immediate.granted == false && LastResult() == "denied");

  dbus::sent_calls.clear();
  base::TimeTicks::now_ms += 2000;
  Result expired_window;
  Request(profile, expired_window);
  Pump();
  assert(!expired_window.granted && dbus::sent_calls.size() == 1);
  dbus::SentCall again = Take(0);
  Reply(again, false, false);
  assert(expired_window.granted == false);

  dbus::sent_calls.clear();
  Result after_denial;
  Request(profile, after_denial);
  Pump();
  assert(!after_denial.granted && dbus::sent_calls.size() == 1);
  dbus::SentCall last = Take(0);
  Reply(last, false, false);
}

void FailuresNeverGrant() {
  struct Case {
    const char* name;
    void (*respond)(dbus::SentCall&);
    const char* result;
  };
  const Case cases[] = {
      {"denied", [](dbus::SentCall& call) { Reply(call, false, false); }, "denied"},
      {"dismissed", [](dbus::SentCall& call) { Reply(call, false, false, {{"polkit.dismissed", "true"}}); }, "cancelled"},
      {"challenge", [](dbus::SentCall& call) { Reply(call, false, true); }, "unavailable"},
      {"authorized challenge", [](dbus::SentCall& call) { Reply(call, true, true); }, "unavailable"},
      {"cancelled", [](dbus::SentCall& call) { Fail(call, "org.freedesktop.PolicyKit1.Error.Cancelled"); }, "cancelled"},
      {"not registered", [](dbus::SentCall& call) { Fail(call, "org.freedesktop.PolicyKit1.Error.Failed"); }, "unavailable"},
      {"no polkit", [](dbus::SentCall& call) { Fail(call, "org.freedesktop.DBus.Error.ServiceUnknown"); }, "unavailable"},
      {"no reply", [](dbus::SentCall& call) { std::move(call.reply).Run(nullptr, nullptr); }, "unavailable"},
      {"malformed", [](dbus::SentCall& call) {
         dbus::Response response;
         dbus::Node result{dbus::Node::Kind::kStruct, false, 0, {}, {}};
         result.children.push_back({dbus::Node::Kind::kBool, true, 0, {}, {}});
         response.body.push_back(std::move(result));
         std::move(call.reply).Run(&response, nullptr);
       }, "unavailable"},
      {"malformed details", [](dbus::SentCall& call) {
         dbus::Response response;
         dbus::Node result{dbus::Node::Kind::kStruct, false, 0, {}, {}};
         result.children.push_back({dbus::Node::Kind::kBool, true, 0, {}, {}});
         result.children.push_back({dbus::Node::Kind::kBool, false, 0, {}, {}});
         dbus::Node array{dbus::Node::Kind::kArray, false, 0, "{ss}", {}};
         array.children.push_back({dbus::Node::Kind::kString, false, 0, "loose", {}});
         result.children.push_back(std::move(array));
         response.body.push_back(std::move(result));
         std::move(call.reply).Run(&response, nullptr);
       }, "unavailable"},
  };
  for (const Case& test : cases) {
    Reset();
    Profile profile;
    Result result;
    Request(profile, result);
    Pump();
    assert(dbus::sent_calls.size() == 1);
    dbus::SentCall check = Take(0);
    test.respond(check);
    if (result.granted != false || result.runs != 1 || LastResult() != test.result) {
      std::printf("case %s gave %s\n", test.name, LastResult().c_str());
      assert(false);
    }
    dbus::sent_calls.clear();
    Result next;
    Request(profile, next);
    Pump();
    assert(dbus::sent_calls.size() == 1 && !next.granted);
  }
}

void TimeoutCancelsTheAgentPrompt() {
  Reset();
  Profile profile;
  Result result;
  Request(profile, result);
  Pump();
  dbus::SentCall check = Take(0);
  Fail(check, "org.freedesktop.DBus.Error.NoReply");
  assert(result.granted == false && LastResult() == "expired");
  assert(dbus::sent_calls.size() == 2);
  ExpectCancel(dbus::sent_calls[1], check.body[4].text);
}

void NewerRequestSupersedesAndStaleRepliesAreIgnored() {
  Reset();
  Profile profile;
  Result first;
  Result second;
  Request(profile, first);
  Pump();
  dbus::SentCall first_check = Take(0);
  Request(profile, second);
  assert(first.runs == 1 && first.granted == false);
  assert(LastResult() == "cancelled");
  ExpectCancel(dbus::sent_calls[1], first_check.body[4].text);
  Pump();
  assert(dbus::sent_calls.size() == 3);
  dbus::SentCall second_check = Take(2);
  ExpectCheck(second_check);
  assert(second_check.body[4].text != first_check.body[4].text);
  Reply(first_check, true, false);
  assert(first.runs == 1 && first.granted == false && !second.granted);
  Reply(second_check, true, false);
  assert(second.runs == 1 && second.granted == true);
}

void UnconnectedBusIsUnavailable() {
  Reset();
  dbus_thread_linux::system_bus->connects = false;
  Profile profile;
  Result result;
  Request(profile, result);
  Pump();
  assert(result.granted == false && dbus::sent_calls.empty());
  assert(LastResult() == "unavailable");
}

struct Probed {
  std::optional<bool> available;
  std::string reason;
  int runs = 0;
};

void Probe(Probed& probed) {
  ardia::ProbeReauth(base::OnceCallback<void(bool, std::string)>([&probed](bool available, std::string reason) {
    probed.available = available;
    probed.reason = std::move(reason);
    ++probed.runs;
  }));
}

void ProbeNeverPromptsAndExplainsUnavailability() {
  Reset();
  ardiacore::background_instance = true;
  Probed background;
  Probe(background);
  assert(background.available == false && background.reason == "background" && dbus::sent_calls.empty());

  Reset();
  dbus_thread_linux::system_bus->connects = false;
  Probed no_bus;
  Probe(no_bus);
  Pump();
  assert(no_bus.available == false && no_bus.reason == "noPolkit" && dbus::sent_calls.empty());

  struct Case {
    void (*respond)(dbus::SentCall&);
    bool available;
    const char* reason;
  };
  const Case cases[] = {
      {[](dbus::SentCall& call) { Reply(call, false, true); }, true, "available"},
      {[](dbus::SentCall& call) { Reply(call, true, false); }, true, "available"},
      {[](dbus::SentCall& call) { Reply(call, false, false); }, false, "notPermitted"},
      {[](dbus::SentCall& call) { Fail(call, "org.freedesktop.PolicyKit1.Error.Failed", "Action dev.ardia.linux.reauthenticate is not registered"); }, false, "policyMissing"},
      {[](dbus::SentCall& call) { Fail(call, "org.freedesktop.PolicyKit1.Error.Failed", "Something else"); }, false, "unavailable"},
      {[](dbus::SentCall& call) { Fail(call, "org.freedesktop.DBus.Error.ServiceUnknown"); }, false, "noPolkit"},
      {[](dbus::SentCall& call) { Fail(call, "org.freedesktop.DBus.Error.NameHasNoOwner"); }, false, "noPolkit"},
      {[](dbus::SentCall& call) { Fail(call, "org.freedesktop.DBus.Error.NoReply"); }, false, "unavailable"},
      {[](dbus::SentCall& call) { std::move(call.reply).Run(nullptr, nullptr); }, false, "unavailable"},
  };
  for (const Case& test : cases) {
    Reset();
    Probed probed;
    Probe(probed);
    Pump();
    assert(dbus::sent_calls.size() == 1);
    dbus::SentCall check = Take(0);
    assert(check.member == "CheckAuthorization" && check.timeout_ms == 5000);
    assert(check.body.size() == 5 && check.body[1].text == "dev.ardia.linux.reauthenticate");
    assert(check.body[3].kind == dbus::Node::Kind::kUint32 && check.body[3].number == 0);
    assert(check.body[4].text.empty());
    test.respond(check);
    if (probed.runs != 1 || probed.available != test.available || probed.reason != test.reason) {
      std::printf("probe gave %s\n", probed.reason.c_str());
      assert(false);
    }
    assert(ardia::emitted.empty());
  }
}

}

int main(int argc, char**) {
  if (argc > 1) {
    content::BrowserThread::on_ui = false;
    Profile profile;
    Result result;
    Request(profile, result);
    return 0;
  }
  BackgroundAndPrivateNeverPrompt();
  GrantIsRememberedOnlyWithinValidity();
  FailuresNeverGrant();
  TimeoutCancelsTheAgentPrompt();
  NewerRequestSupersedesAndStaleRepliesAreIgnored();
  UnconnectedBusIsUnavailable();
  ProbeNeverPromptsAndExplainsUnavailability();
  std::puts("reauth scenarios passed");
}
