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

int main(int argc, char** argv) {
  assert(argc == 2);
  TypedMethods();
  ExportCleanup(argv[1]);
  Origins();
  std::puts("credentials scenarios passed");
}
