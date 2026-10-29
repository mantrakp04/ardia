#include <cassert>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <random>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "ardia/linux/ac_linux_credentials.h"

using namespace ardia::linux_credentials;

namespace {

std::string FixtureSecret(std::string_view prefix) {
  static std::mt19937_64 engine(std::random_device{}());
  std::string secret(prefix);
  for (int i = 0; i < 24; ++i) secret.push_back("0123456789abcdefghijklmnopqrstuvwxyz"[engine() % 36]);
  return secret;
}

const std::string kPassword = FixtureSecret("fixture \"q\" \\ ");
const std::string kCardNumber = "4111 1111-1111 1111";

std::string Hex(const std::string& text) {
  static constexpr char kDigits[] = "0123456789abcdef";
  std::string out;
  for (unsigned char byte : text) {
    out.push_back(kDigits[byte >> 4]);
    out.push_back(kDigits[byte & 15]);
  }
  return out;
}

Arg Object(std::vector<std::pair<std::string, Arg>> members) {
  return Arg::Object(std::move(members));
}

std::vector<Arg> Values(std::vector<Arg> values) {
  return values;
}

void ExpectInvalid(const Plan& plan, const char* code) {
  if (plan.code != code) {
    std::printf("expected %s, got '%s'\n", code, plan.code.c_str());
    assert(false);
  }
  assert(plan.service.empty() && plan.args.empty());
}

void ExpectEngine(const Plan& plan, const char* service, const std::string& args, Reply reply,
                  std::vector<Store> stores) {
  if (!plan.ok() || plan.service != service || plan.args.value() != args) {
    std::printf("plan %s %s %s\n", plan.code.c_str(), plan.service.c_str(), plan.args.value().c_str());
    assert(false);
  }
  assert(plan.reply == reply);
  assert(plan.requires_stores == stores);
}

void GenericCalls() {
  ExpectEngine(PlanCall("passwords.list", Object({})), "ac_passwords_list", "{}", Reply::kAsIs, {Store::kPasswords});
  ExpectEngine(PlanCall("passwords.neverSaveOrigins", Object({})), "ac_passwords_exceptions", "{}", Reply::kAsIs,
               {Store::kPasswords});
  ExpectEngine(PlanCall("passwords.remove", Object({{"origin", Arg::String("HTTPS://User:pw@Example.COM:8443/login?x=1")},
                                                   {"username", Arg::String("me")},
                                                   {"password", Arg::String(kPassword)}})),
               "ac_passwords_remove", R"({"origin":"https://example.com:8443","username":"me"})", Reply::kOk,
               {Store::kPasswords});
  ExpectInvalid(PlanCall("passwords.remove", Object({{"origin", Arg::String("example.com")}, {"username", Arg::String("")}})),
                "ERR_CREDENTIAL_REQUEST");
  ExpectInvalid(PlanCall("passwords.remove", Object({{"origin", Arg::String("https://a.test")}})), "ERR_CREDENTIAL_REQUEST");
  ExpectInvalid(PlanCall("passwords.remove", Object({{"origin", Arg::String("https://a.test")}, {"username", Arg::String(std::string(kMaxUsernameBytes + 1, 'u'))}})),
                "ERR_CREDENTIAL_REQUEST");
  ExpectEngine(PlanCall("passwords.allowSaving", Object({{"origin", Arg::String("http://Site.test/path")}})),
               "ac_passwords_allow", R"({"origin":"http://site.test"})", Reply::kOk, {Store::kPasswords});
  ExpectInvalid(PlanCall("passwords.allowSaving", Object({{"origin", Arg::String("https://bad host.test")}})),
                "ERR_CREDENTIAL_REQUEST");
  ExpectInvalid(PlanCall("passwords.allowSaving", Object({{"origin", Arg::String(std::string("https://a\0b", 11))}})),
                "ERR_CREDENTIAL_REQUEST");

  Plan enabled = PlanCall("passwords.autofillEnabled", Object({}));
  assert(enabled.ok() && enabled.service.empty() && enabled.reply == Reply::kPreference);
  assert(enabled.reads.size() == 1 && enabled.reads[0].second == "credentials_enable_service");
  Plan set = PlanCall("passwords.setAutofillEnabled", Object({{"enabled", Arg::Bool(false)}}));
  assert(set.ok() && set.reply == Reply::kNull && set.writes.size() == 1);
  assert(set.writes[0].first == "credentials_enable_service" && !set.writes[0].second);
  ExpectInvalid(PlanCall("passwords.setAutofillEnabled", Object({{"enabled", Arg::String("no")}})), "ERR_CREDENTIAL_REQUEST");
  ExpectInvalid(PlanCall("passwords.setAutofillEnabled", Object({})), "ERR_CREDENTIAL_REQUEST");

  Plan settings = PlanCall("autofill.settings", Object({}));
  assert(settings.ok() && settings.reply == Reply::kPreferences && settings.reads.size() == 2);
  assert(settings.reads[0].second == "autofill.profile_enabled" && settings.reads[1].second == "autofill.credit_card_enabled");
  Plan set_settings = PlanCall("autofill.setSettings", Object({{"cards", Arg::Bool(false)}}));
  assert(set_settings.ok() && set_settings.writes.size() == 1);
  assert(set_settings.writes[0].first == "autofill.credit_card_enabled" && !set_settings.writes[0].second);
  Plan both = PlanCall("autofill.setSettings", Object({{"addresses", Arg::Bool(true)}, {"cards", Arg::Bool(true)}}));
  assert(both.ok() && both.writes.size() == 2);
  ExpectInvalid(PlanCall("autofill.setSettings", Object({{"addresses", Arg::Number(1)}})), "ERR_CREDENTIAL_REQUEST");

  ExpectEngine(PlanCall("autofill.addresses", Object({})), "ac_autofill_addresses", "{}", Reply::kAsIs, {Store::kAddresses});
  ExpectEngine(PlanCall("autofill.cards", Object({})), "ac_autofill_cards", "{}", Reply::kAsIs, {Store::kCards});
  ExpectEngine(PlanCall("autofill.saveAddress",
                        Object({{"address", Object({{"name", Arg::String("Ada \"Countess\" Lovelace")},
                                                    {"postalCode", Arg::Number(2139)},
                                                    {"street", Arg::String("1 Analytical Row\nFloor 2")},
                                                    {"cardNumber", Arg::String(kCardNumber)},
                                                    {"email", Arg::Bool(true)},
                                                    {"id", Arg::String("6f1d0b6c-0c1e-4f3a-9b1e-2d6a3c1b7e10")}})}})),
               "ac_autofill_save_address",
               R"({"address":{"id":"6f1d0b6c-0c1e-4f3a-9b1e-2d6a3c1b7e10","name":"Ada \"Countess\" Lovelace","street":"1 Analytical Row\u000aFloor 2","postalCode":"2139"}})",
               Reply::kAsIs, {Store::kAddresses});
  ExpectInvalid(PlanCall("autofill.saveAddress", Object({{"address", Object({{"city", Arg::String(std::string(kMaxFieldBytes + 1, 'c'))}})}})),
                "ERR_CREDENTIAL_REQUEST");
  ExpectInvalid(PlanCall("autofill.saveAddress", Object({{"address", Object({{"id", Arg::String("../x")}})}})), "ERR_CREDENTIAL_REQUEST");
  ExpectInvalid(PlanCall("autofill.saveAddress", Object({})), "ERR_CREDENTIAL_REQUEST");
  ExpectEngine(PlanCall("autofill.remove", Object({{"id", Arg::String("abc-123")}})), "ac_autofill_remove",
               R"({"id":"abc-123"})", Reply::kOk, {Store::kAddresses});
  ExpectInvalid(PlanCall("autofill.remove", Object({{"id", Arg::String("a\"b")}})), "ERR_CREDENTIAL_REQUEST");
  ExpectInvalid(PlanCall("autofill.remove", Object({})), "ERR_CREDENTIAL_REQUEST");
  ExpectInvalid(PlanCall("passwords.list", Arg::String("x")), "ERR_CREDENTIAL_REQUEST");

  for (const char* name : {"passwords.unlock", "passwords.reveal", "passwords.export", "passwords.save",
                           "passwords.update", "passwords.add", "autofill.cardNumber", "autofill.saveCard"}) {
    assert(HandlesCall(name));
    ExpectInvalid(PlanCall(name, Object({{"origin", Arg::String("https://a.test")}, {"password", Arg::String(kPassword)}})),
                  "ERR_SECRET_ROUTE");
  }
  assert(!HandlesCall("autofill.showSuggestions") && !HandlesCall("passwords.") && !HandlesCall("ac_passwords_reveal"));
  ExpectInvalid(PlanCall("autofill.showSuggestions", Object({})), "ERR_UNKNOWN_CALL");
}

void TypedMethods() {
  for (const char* capability : kCapabilities) {
    assert(HandlesInvoke(capability));
    std::printf("capability %s\n", capability);
  }
  assert(!HandlesInvoke("ArdiaPasswords.call") && !HandlesInvoke("ArdiaPasswords.list"));
  ExpectEngine(PlanInvoke("ArdiaPasswords.unlock", Values({Arg::String("work")})), "ac_passwords_unlock", "{}", Reply::kUnlocked,
               {Store::kPasswords});
  ExpectInvalid(PlanInvoke("ArdiaPasswords.unlock", Values({Arg::String(std::string(300, 'w'))})), "ERR_PROFILE");
  ExpectInvalid(PlanInvoke("ArdiaPasswords.unlock", Values({Arg::String(std::string("a\0b", 3))})), "ERR_PROFILE");
  ExpectInvalid(PlanInvoke("ArdiaPasswords.unlock", Values({Arg::Number(1)})), "ERR_PROFILE");
  ExpectInvalid(PlanInvoke("ArdiaPasswords.unlock", Values({})), "ERR_PROFILE");
  ExpectInvalid(PlanInvoke("ArdiaPasswords.unlock", Values({Arg::String(""), Arg::String("extra")})), "ERR_CREDENTIAL_REQUEST");
  ExpectInvalid(PlanInvoke("ArdiaPasswords.list", Values({Arg::String("")})), "ERR_UNKNOWN_CALL");
  assert(ClaimsInvoke("ArdiaPasswords.list") && ClaimsInvoke("ArdiaAutofill.addresses") && ClaimsInvoke("ArdiaPasswords.status"));
  assert(!ClaimsInvoke("ArdiaSync.status") && !ClaimsInvoke("ArdiaPasswordsX.list") && !ClaimsInvoke("passwords.list") &&
         !ClaimsInvoke("ArdiaPasswords"));
  const Arg private_profile = Arg::String("incognito:w-1@");
  for (const char* capability : kCapabilities) {
    const Plan refused = PlanWindowInvoke(true, capability, Values({private_profile}));
    ExpectInvalid(refused, "ERR_PROFILE_PRIVATE");
    assert(refused.message == kPrivateCredentialsMessage);
  }
  for (const char* method : {"ArdiaPasswords.list", "ArdiaAutofill.addresses", "ArdiaPasswords.call"}) {
    ExpectInvalid(PlanWindowInvoke(true, method, Values({private_profile})), "ERR_PROFILE_PRIVATE");
    ExpectInvalid(PlanWindowInvoke(false, method, Values({Arg::String("")})), "ERR_UNKNOWN_CALL");
  }
  ExpectInvalid(PlanWindowInvoke(true, "ArdiaPasswords.unlock", Values({})), "ERR_PROFILE_PRIVATE");
  ExpectInvalid(PlanWindowInvoke(true, "ArdiaPasswords.unlock", Values({Arg::String(""), Arg::String("extra")})), "ERR_PROFILE_PRIVATE");
  ExpectInvalid(PlanWindowInvoke(false, "ArdiaPasswords.unlock", Values({})), "ERR_PROFILE");
  ExpectEngine(PlanWindowInvoke(false, "ArdiaPasswords.unlock", Values({Arg::String("work")})), "ac_passwords_unlock", "{}",
               Reply::kUnlocked, {Store::kPasswords});

  Plan status = PlanInvoke("ArdiaPasswords.status", Values({Arg::String("default")}));
  assert(status.ok() && status.reply == Reply::kStatus && status.service.empty() && status.requires_stores.empty());
  ExpectEngine(PlanInvoke("ArdiaPasswords.unlock", Values({Arg::String("")})), "ac_passwords_unlock", "{}", Reply::kUnlocked,
               {Store::kPasswords});
  ExpectEngine(PlanInvoke("ArdiaPasswords.reveal", Values({Arg::String(""), Arg::String("https://Example.com/a"), Arg::String("me")})),
               "ac_passwords_reveal", R"({"origin":"https://example.com","username":"me"})", Reply::kPassword,
               {Store::kPasswords});

  Plan save = PlanInvoke("ArdiaPasswords.save",
                         Values({Arg::String(""), Arg::String("https://example.com"), Arg::String("me"), Arg::String(kPassword)}));
  ExpectEngine(save, "ac_passwords_add",
               std::string(R"({"origin":"https://example.com","username":"me","passwordHex":")") + Hex(kPassword) + "\"}",
               Reply::kOk, {Store::kPasswords});
  assert(save.args.value().find("horse") == std::string::npos);
  assert(save.args.value().find("\"password\"") == std::string::npos);
  ExpectInvalid(PlanInvoke("ArdiaPasswords.save", Values({Arg::String(""), Arg::String("https://a.test"), Arg::String("me"), Arg::String("")})),
                "ERR_CREDENTIAL_REQUEST");
  ExpectInvalid(PlanInvoke("ArdiaPasswords.save", Values({Arg::String(""), Arg::String("https://a.test"), Arg::String("me"), Arg::Null()})),
                "ERR_CREDENTIAL_REQUEST");
  ExpectInvalid(PlanInvoke("ArdiaPasswords.save", Values({Arg::String(""), Arg::String("https://a.test"), Arg::String("me"),
                                                          Arg::String(std::string(kMaxSecretBytes + 1, 'p'))})),
                "ERR_CREDENTIAL_REQUEST");
  ExpectInvalid(PlanInvoke("ArdiaPasswords.save", Values({Arg::String(""), Arg::String("https://a.test"), Arg::String("me"),
                                                          Arg::String(std::string("a\0b", 3))})),
                "ERR_CREDENTIAL_REQUEST");

  Plan rename = PlanInvoke("ArdiaPasswords.update", Values({Arg::String(""), Arg::String("https://a.test"), Arg::String("me"),
                                                            Arg::String("you"), Arg::Null()}));
  ExpectEngine(rename, "ac_passwords_update", R"({"origin":"https://a.test","username":"me","newUsername":"you"})", Reply::kOk,
               {Store::kPasswords});
  Plan change = PlanInvoke("ArdiaPasswords.update", Values({Arg::String(""), Arg::String("https://a.test"), Arg::String("me"),
                                                            Arg::Null(), Arg::String(kPassword)}));
  ExpectEngine(change, "ac_passwords_update",
               std::string(R"({"origin":"https://a.test","username":"me","newPasswordHex":")") + Hex(kPassword) + "\"}",
               Reply::kOk, {Store::kPasswords});
  assert(change.args.value().find("horse") == std::string::npos);
  ExpectInvalid(PlanInvoke("ArdiaPasswords.update", Values({Arg::String(""), Arg::String("https://a.test"), Arg::String("me"),
                                                            Arg::Bool(true), Arg::Null()})),
                "ERR_CREDENTIAL_REQUEST");
  ExpectInvalid(PlanInvoke("ArdiaPasswords.update", Values({Arg::String(""), Arg::String("https://a.test"), Arg::String("me"),
                                                            Arg::Null(), Arg::String("")})),
                "ERR_CREDENTIAL_REQUEST");

  Plan exporting = PlanInvoke("ArdiaPasswords.export", Values({Arg::String("")}));
  assert(exporting.ok() && exporting.asks_for_path && exporting.service.empty() && exporting.reply == Reply::kExport);
  assert(exporting.requires_stores == std::vector<Store>{Store::kPasswords});
  ExpectEngine(PlanExport("/tmp/scratch/Ardia Passwords.csv"), "ac_passwords_export",
               R"({"path":"/tmp/scratch/Ardia Passwords.csv"})", Reply::kExport, {Store::kPasswords});
  ExpectInvalid(PlanExport("relative.csv"), "ERR_EXPORT_PATH");
  ExpectInvalid(PlanExport(""), "ERR_EXPORT_PATH");
  ExpectInvalid(PlanExport(std::string("/tmp/a\0b", 8)), "ERR_EXPORT_PATH");

  Plan card = PlanInvoke("ArdiaAutofill.saveCard",
                         Values({Arg::String(""),
                                 Object({{"name", Arg::String("Ada")}, {"expMonth", Arg::Number(4)}, {"expYear", Arg::Number(2031)},
                                         {"number", Arg::String("4000000000000002")}}),
                                 Arg::String(kCardNumber)}));
  ExpectEngine(card, "ac_autofill_save_card",
               std::string(R"({"card":{"name":"Ada","expMonth":4,"expYear":2031},"numberHex":")") + Hex(kCardNumber) + "\"}",
               Reply::kAsIs, {Store::kCards});
  assert(card.args.value().find("4111") == std::string::npos && card.args.value().find("4000") == std::string::npos);
  Plan existing = PlanInvoke("ArdiaAutofill.saveCard",
                             Values({Arg::String(""), Object({{"id", Arg::String("card-1")}, {"name", Arg::Null()}}), Arg::Null()}));
  ExpectEngine(existing, "ac_autofill_save_card", R"({"card":{"id":"card-1"}})", Reply::kAsIs, {Store::kCards});
  ExpectInvalid(PlanInvoke("ArdiaAutofill.saveCard", Values({Arg::String(""), Object({}), Arg::Null()})), "ERR_CARD_NUMBER");
  ExpectInvalid(PlanInvoke("ArdiaAutofill.saveCard", Values({Arg::String(""), Object({}), Arg::String("4111x111111111111")})),
                "ERR_CARD_NUMBER");
  ExpectInvalid(PlanInvoke("ArdiaAutofill.saveCard", Values({Arg::String(""), Object({}), Arg::String("41111")})), "ERR_CARD_NUMBER");
  ExpectInvalid(PlanInvoke("ArdiaAutofill.saveCard", Values({Arg::String(""), Object({{"expMonth", Arg::Number(13)}}), Arg::String(kCardNumber)})),
                "ERR_CREDENTIAL_REQUEST");
  ExpectInvalid(PlanInvoke("ArdiaAutofill.saveCard", Values({Arg::String(""), Object({{"expYear", Arg::Number(2031.5)}}), Arg::String(kCardNumber)})),
                "ERR_CREDENTIAL_REQUEST");
  ExpectInvalid(PlanInvoke("ArdiaAutofill.saveCard", Values({Arg::String(""), Arg::String("card"), Arg::String(kCardNumber)})),
                "ERR_CREDENTIAL_REQUEST");
  ExpectEngine(PlanInvoke("ArdiaAutofill.cardNumber", Values({Arg::String(""), Arg::String("card-1")})), "ac_autofill_card_number",
               R"({"id":"card-1"})", Reply::kCardNumber, {Store::kCards});
  ExpectInvalid(PlanInvoke("ArdiaAutofill.cardNumber", Values({Arg::String(""), Arg::String("")})), "ERR_CREDENTIAL_REQUEST");
}

void StoreAvailability() {
  Probe healthy;
  for (Store store : {Store::kPasswords, Store::kAddresses, Store::kCards}) {
    assert(Assess(store, healthy).available);
  }
  Probe private_profile;
  private_profile.private_profile = true;
  auto denied = Assess(Store::kPasswords, private_profile);
  assert(!denied.available && denied.code == "ERR_PROFILE_PRIVATE" && denied.reason == "privateProfile");
  assert(Assess(Store::kAddresses, private_profile).code == "ERR_PROFILE_PRIVATE");

  Probe missing;
  missing.service = false;
  assert(Assess(Store::kPasswords, missing).code == "ERR_PASSWORDS_UNAVAILABLE");
  assert(Assess(Store::kCards, missing).code == "ERR_AUTOFILL_UNAVAILABLE");
  assert(Assess(Store::kCards, missing).reason == "noStore");

  Probe locked;
  locked.error = StoreError::kKeychain;
  auto keyring = Assess(Store::kPasswords, locked);
  assert(!keyring.available && keyring.reason == "keyringLocked" && keyring.code == "ERR_PASSWORDS_UNAVAILABLE");
  assert(Assess(Store::kAddresses, locked).available);

  Probe broken;
  broken.error = StoreError::kInactionable;
  assert(Assess(Store::kPasswords, broken).reason == "storeFailed");
  broken.error = StoreError::kOther;
  assert(Assess(Store::kPasswords, broken).reason == "storeFailed");
  Probe temporary;
  temporary.error = StoreError::kTemporary;
  assert(Assess(Store::kPasswords, temporary).available);

  assert(AwaitsStore(StoreError::kInactionable, 0));
  assert(AwaitsStore(StoreError::kInactionable, 2000));
  assert(AwaitsStore(StoreError::kInactionable, kStoreReadyTimeoutMs - 1));
  assert(!AwaitsStore(StoreError::kInactionable, kStoreReadyTimeoutMs));
  for (StoreError settled : {StoreError::kNone, StoreError::kTemporary, StoreError::kKeychain, StoreError::kOther}) {
    assert(!AwaitsStore(settled, 0));
  }
  assert(kStoreReadyPollMs > 0 && kStoreReadyPollMs < kStoreReadyTimeoutMs);
  std::vector<StoreError> loading(40, StoreError::kInactionable);
  loading.push_back(StoreError::kNone);
  Probe first_call;
  int64_t waited = 0;
  size_t read = 0;
  first_call.error = loading[read];
  while (AwaitsStore(first_call.error, waited)) {
    waited += kStoreReadyPollMs;
    first_call.error = loading[++read];
  }
  assert(Assess(Store::kPasswords, first_call).available);
  assert(waited == 40 * kStoreReadyPollMs);

  Probe no_key;
  no_key.encryption = false;
  assert(Assess(Store::kPasswords, no_key).reason == "encryptionUnavailable");
  assert(Assess(Store::kCards, no_key).reason == "encryptionUnavailable");
  assert(Assess(Store::kAddresses, no_key).available);
  Probe no_decrypt;
  no_decrypt.decryption = false;
  assert(!Assess(Store::kCards, no_decrypt).available);
}

void StorageProtection() {
  assert(ProtectionFromCiphertext("v10\x01\x02") == Protection::kObfuscated);
  assert(ProtectionFromCiphertext("v11abc") == Protection::kKeyring);
  assert(ProtectionFromCiphertext("v12abc") == Protection::kPortal);
  assert(ProtectionFromCiphertext("v1") == Protection::kUnknown);
  assert(ProtectionFromCiphertext("") == Protection::kUnknown);
  assert(ProtectionFromCiphertext("v13abc") == Protection::kUnknown);
  assert(ProtectionFromCiphertext("V11abc") == Protection::kUnknown);

  const Storage fallback = DescribeStorage("gnome-libsecret", Protection::kObfuscated);
  assert(fallback.protection == "obfuscated" && fallback.fallback);
  assert(fallback.label.find("built-in key") != std::string::npos);
  assert(DescribeStorage("auto", Protection::kObfuscated).fallback);
  assert(DescribeStorage("kwallet6", Protection::kObfuscated).fallback);
  const Storage basic = DescribeStorage("basic", Protection::kObfuscated);
  assert(basic.protection == "obfuscated" && !basic.fallback);
  assert(basic.label.find("basic") != std::string::npos);

  const Storage secret_service = DescribeStorage("gnome-libsecret", Protection::kKeyring);
  assert(secret_service.protection == "keyring" && !secret_service.fallback);
  assert(secret_service.label == "the Secret Service keyring");
  for (const char* wallet : {"kwallet", "kwallet5", "kwallet6"}) {
    assert(DescribeStorage(wallet, Protection::kKeyring).label == "KWallet");
  }
  assert(DescribeStorage("auto", Protection::kKeyring).label == "your desktop keyring (Secret Service or KWallet)");
  assert(DescribeStorage("", Protection::kKeyring).label == "your desktop keyring (Secret Service or KWallet)");
  assert(DescribeStorage("auto", Protection::kPortal).protection == "portal");
  assert(DescribeStorage("auto", Protection::kPortal).label == "your desktop's secret portal");
  assert(DescribeStorage("auto", Protection::kNone).protection == "none");
  assert(!DescribeStorage("auto", Protection::kNone).fallback);
  assert(DescribeStorage("auto", Protection::kUnknown).protection == "unknown");
  assert(!DescribeStorage("auto", Protection::kUnknown).fallback);
  assert(DescribeStorage("auto", Protection::kUnknown).label == "an unknown key");
  assert(DescribeStorage("gnome-libsecret", Protection::kUnknown).label.find("encrypt") == std::string::npos);

  Probe weak;
  weak.protection = Protection::kObfuscated;
  assert(Assess(Store::kPasswords, weak).available);
  assert(Assess(Store::kCards, weak).available);
}

void EngineErrors() {
  assert(ClassifyEngineError("OS authentication is unavailable on this platform").code == "ERR_REAUTH_UNAVAILABLE");
  assert(ClassifyEngineError("Not authenticated").code == "ERR_REAUTH_DENIED");
  assert(ClassifyEngineError("no engine data for a private profile").code == "ERR_PROFILE_PRIVATE");
  assert(ClassifyEngineError("no password manager").code == "ERR_PASSWORDS_UNAVAILABLE");
  assert(ClassifyEngineError("no autofill in this profile").code == "ERR_AUTOFILL_UNAVAILABLE");
  assert(ClassifyEngineError("No such password").code == "ERR_NOT_FOUND");
  assert(ClassifyEngineError("invalid number").code == "ERR_CARD_NUMBER");
  assert(ReauthMessage("available").empty());
  assert(ReauthMessage("policyMissing").find("polkit policy isn't installed") != std::string::npos);
  assert(ReauthMessage("policyMissing").find("/usr/share/polkit-1/actions") != std::string::npos);
  assert(ReauthMessage("noPolkit").find("polkit isn't running") != std::string::npos);
  assert(ReauthMessage("background").find("background") != std::string::npos);
  assert(ReauthMessage("notPermitted").find("isn't allowed") != std::string::npos);
  assert(ReauthMessage("anything else").find("unavailable") != std::string::npos);
  Failure leaked = ClassifyEngineError("bad value " + kPassword);
  assert(leaked.code == "ERR_ENGINE" && leaked.message.find("horse") == std::string::npos);
}

void Wiping() {
  std::string secret(200, 's');
  const char* bytes = secret.data();
  Wipe(secret);
  assert(secret.empty());
  for (size_t i = 0; i < 200; ++i) {
    assert(bytes[i] == 0);
  }
  SecretText text(std::string(100, 'x'));
  SecretText moved(std::move(text));
  assert(text.empty() && moved.value() == std::string(100, 'x'));
  const char* held = moved.value().data();
  moved.Clear();
  for (size_t i = 0; i < 100; ++i) {
    assert(held[i] == 0);
  }
  Arg arg = Arg::String(std::string(64, 'p'));
  Arg taken(std::move(arg));
  assert(arg.text.empty() && taken.text.size() == 64);
  Arg small = Arg::String("hunter2");
  const char* small_bytes = small.text.data();
  Arg small_taken(std::move(small));
  assert(small.text.empty() && small_taken.text == "hunter2");
  for (size_t i = 0; i < 7; ++i) {
    assert(small_bytes[i] == 0);
  }
  Arg source = Arg::String("swordfish");
  const char* source_bytes = source.text.data();
  Arg target = Arg::String("x");
  target = std::move(source);
  assert(source.text.empty() && target.text == "swordfish");
  for (size_t i = 0; i < 9; ++i) {
    assert(source_bytes[i] == 0);
  }
}

void ExportCleanup(const std::filesystem::path& scratch) {
  assert(ShouldRemoveFailedExport("writeFailed", false, true));
  assert(ShouldRemoveFailedExport("reauthFailed", false, true));
  assert(ShouldRemoveFailedExport("cancelled", false, true));
  assert(!ShouldRemoveFailedExport("succeeded", false, true));
  assert(!ShouldRemoveFailedExport("inProgress", false, true));
  assert(!ShouldRemoveFailedExport("writeFailed", true, true));
  assert(!ShouldRemoveFailedExport("writeFailed", false, false));

  const auto partial = scratch / "partial.csv";
  std::ofstream(partial) << "name,url,username,password\n";
  assert(RemoveFailedExport(partial.string(), "writeFailed", false));
  assert(!std::filesystem::exists(partial));

  const auto kept = scratch / "kept.csv";
  std::ofstream(kept) << "user data";
  assert(!RemoveFailedExport(kept.string(), "writeFailed", true));
  assert(std::filesystem::exists(kept));
  assert(!RemoveFailedExport(kept.string(), "succeeded", false));
  assert(std::filesystem::exists(kept));

  const auto link = scratch / "link.csv";
  std::filesystem::create_symlink(kept, link);
  assert(!RemoveFailedExport(link.string(), "writeFailed", false));
  assert(std::filesystem::exists(kept) && std::filesystem::is_symlink(link));
  assert(!RemoveFailedExport((scratch / "absent.csv").string(), "writeFailed", false));
}

void Origins() {
  assert(NormalizeOrigin("https://example.com") == "https://example.com");
  assert(NormalizeOrigin("HTTPS://EXAMPLE.com:443/") == "https://example.com:443");
  assert(NormalizeOrigin("android://Ab3+Hash==@com.example/") == "android://Ab3+Hash==@com.example");
  assert(NormalizeOrigin("HTTP://user:pw@Example.com/") == "http://example.com");
  assert(!NormalizeOrigin("https://"));
  assert(!NormalizeOrigin("://example.com"));
  assert(!NormalizeOrigin("1https://example.com"));
  assert(!NormalizeOrigin("https://exa mple.com"));
  assert(!NormalizeOrigin(std::string(kMaxOriginBytes + 1, 'a')));
}

}

void SyncedLogins() {
  SyncedLoginPlans plans = PlanSyncedLogin("default", "https://example.com", "me", kPassword);
  assert(plans.storable);
  ExpectEngine(plans.remove, "ac_passwords_remove", R"({"origin":"https://example.com","username":"me"})", Reply::kOk,
               {Store::kPasswords});
  ExpectEngine(plans.save, "ac_passwords_add",
               std::string(R"({"origin":"https://example.com","username":"me","passwordHex":")") + Hex(kPassword) + "\"}",
               Reply::kOk, {Store::kPasswords});
  assert(PlanSyncedLogin("default", "https://example.com", "", kPassword).storable);
  assert(!PlanSyncedLogin("default", "https://example.com", "me", std::string(kMaxSecretBytes + 1, 'p')).storable);
  assert(!PlanSyncedLogin("default", "https://example.com", "me", std::string("a\0b", 3)).storable);
  assert(!PlanSyncedLogin("default", "https://example.com", std::string("m\0e", 3), kPassword).storable);
  assert(!PlanSyncedLogin("default", "https://example.com", std::string(kMaxUsernameBytes + 1, 'u'), kPassword).storable);
  assert(!PlanSyncedLogin("default", "https://example.com", "me", "").storable);
  assert(!PlanSyncedLogin("default", "https://example.com/path", "me", kPassword).storable);
  assert(!PlanSyncedLogin("default", "https://Example.com", "me", kPassword).storable);
  assert(PasswordsSyncUsable(false, true, StoreError::kNone));
  assert(!PasswordsSyncUsable(true, true, StoreError::kNone));
  assert(!PasswordsSyncUsable(false, false, StoreError::kNone));
  assert(!PasswordsSyncUsable(false, true, StoreError::kKeychain));
  assert(!PasswordsSyncUsable(false, true, StoreError::kInactionable));
  assert(!PasswordsSyncUsable(false, true, StoreError::kTemporary));
}

int main(int argc, char** argv) {
  StorageProtection();
  assert(argc == 2);
  GenericCalls();
  TypedMethods();
  StoreAvailability();
  EngineErrors();
  Wiping();
  ExportCleanup(argv[1]);
  Origins();
  SyncedLogins();
  std::puts("credentials scenarios passed");
}
