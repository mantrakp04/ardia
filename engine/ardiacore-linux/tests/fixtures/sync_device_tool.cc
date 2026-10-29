#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <map>
#include <optional>
#include <string>
#include <utility>

#include "ardia/linux/ac_linux_credentials.h"
#include "ardia/linux/ac_linux_sync_crypto.h"
#include "ardia/linux/ac_linux_sync.h"
#include "ardia/linux/ac_linux_sync_json.h"
#include "ardia/linux/ac_linux_sync_keystore.h"
#include "ardia/linux/ac_linux_sync_vault.h"

using namespace ardia::linux_sync;

namespace {

using LoginKey = std::pair<std::string, std::string>;

std::string KeyRealm(const std::string& realm) {
  return LoginOrigin(realm).value_or(realm);
}

const std::string* Text(const std::vector<JsonValue>& args, size_t index) {
  return index < args.size() && args[index].is_string() ? &args[index].text : nullptr;
}

std::optional<Outcome> LoginStore(std::map<LoginKey, StoredLogin>& logins, std::map<LoginKey, int>& attempts, SyncCore& core,
                                  const std::string& method, const std::vector<JsonValue>& args) {
  if (method == "ArdiaSync.test.addLogin") {
    const std::string* realm = Text(args, 0);
    const std::string* username = Text(args, 1);
    const std::string* password = Text(args, 2);
    if (!realm || !username || !password || args.size() < 4) return Outcome::Error("ERR_TOOL", "addLogin arguments");
    std::string secret = *password;
    logins.insert_or_assign({KeyRealm(*realm), *username},
                            StoredLogin(*realm, *username, std::move(secret), std::strtod(args[3].text.c_str(), nullptr)));
    return Outcome::Value(JsonValue::Null());
  }
  if (method == "ArdiaSync.test.sealLogins") {
    LoginRead read;
    read.complete = !args.empty() && args[0].flag;
    for (const auto& [key, login] : logins) {
      std::string secret = login.password;
      read.logins.emplace_back(login.realm, login.username, std::move(secret), login.created_ms);
    }
    return core.SealLogins(std::move(read));
  }
  if (method == "ArdiaSync.test.saveLogin") {
    auto save = ParsePasswordSave(args);
    if (!save) return Outcome::Error("ERR_SYNC_ARGUMENT", "saveLogin arguments");
    const LoginKey key{save->origin, save->username};
    ++attempts[key];
    if (!save->holdable) return Outcome::Value(JsonValue::String("skipped"));
    auto opened = core.OpenLogin(*save);
    if (!opened) return Outcome::Value(JsonValue::Bool(false));
    auto plans = ardia::linux_credentials::PlanSyncedLogin(save->profile, opened->realm, opened->username, opened->password);
    if (!plans.storable) return Outcome::Value(JsonValue::String("skipped"));
    logins.insert_or_assign(key, std::move(*opened));
    return Outcome::Value(JsonValue::Bool(true));
  }
  if (method == "ArdiaSync.test.removeLogin" || method == "ArdiaSync.test.removeLoginAnyway") {
    const std::string* origin = Text(args, 0);
    const std::string* username = Text(args, 1);
    if (!origin || !username) return Outcome::Error("ERR_TOOL", "removeLogin arguments");
    if (method == "ArdiaSync.test.removeLogin") {
      namespace credentials = ardia::linux_credentials;
      std::vector<std::pair<std::string, credentials::Arg>> login;
      login.emplace_back("origin", credentials::Arg::String(*origin));
      login.emplace_back("username", credentials::Arg::String(*username));
      const credentials::Plan plan = credentials::PlanCall("passwords.remove", credentials::Arg::Object(std::move(login)));
      if (!plan.ok()) return Outcome::Error(plan.code, plan.message);
    }
    logins.erase({KeyRealm(*origin), *username});
    return Outcome::Value(JsonValue::Null());
  }
  if (method == "ArdiaSync.test.saveLoginAnyway") {
    const std::string* origin = Text(args, 0);
    const std::string* username = Text(args, 1);
    const std::string* sealed = Text(args, 2);
    if (!origin || !username || !sealed) return Outcome::Error("ERR_TOOL", "saveLoginAnyway arguments");
    auto opened = core.OpenLogin({"default", *origin, *username, *sealed, true, true});
    if (!opened) return Outcome::Value(JsonValue::Bool(false));
    logins.insert_or_assign({*origin, *username}, std::move(*opened));
    return Outcome::Value(JsonValue::Bool(true));
  }
  if (method == "ArdiaSync.test.sealLoginsAnyway") {
    Outcome words = core.Dispatch("ArdiaSync.recoveryWords", {}, NowSeconds());
    if (!words.ok) return words;
    std::string phrase;
    for (const auto& word : words.value.items) phrase += word.text + " ";
    Bytes entropy;
    if (EntropyFromPhrase(phrase, &entropy).kind != PhraseProblem::Kind::kNone) return Outcome::Error("ERR_TOOL", "phrase");
    const SyncKeys keys(entropy);
    JsonValue list = JsonValue::Array();
    for (const auto& [key, login] : logins) {
      auto sealed = keys.SealPassword(login.password, key.first, login.username);
      if (!sealed) return Outcome::Error("ERR_TOOL", "seal");
      list.Append(JsonValue::Object({{"origin", JsonValue::String(key.first)},
                                     {"username", JsonValue::String(login.username)},
                                     {"sealed", JsonValue::String(*sealed)},
                                     {"created", JsonValue::Number(login.created_ms)}}));
    }
    return Outcome::Value(std::move(list));
  }
  if (method == "ArdiaSync.test.saveAttempts") {
    const std::string* origin = Text(args, 0);
    const std::string* username = Text(args, 1);
    if (!origin || !username) return Outcome::Error("ERR_TOOL", "saveAttempts arguments");
    const auto found = attempts.find({*origin, *username});
    return Outcome::Value(JsonValue::Number(found == attempts.end() ? 0 : found->second));
  }
  if (method == "ArdiaSync.test.hasLogin") {
    const std::string* origin = Text(args, 0);
    const std::string* username = Text(args, 1);
    const std::string* password = Text(args, 2);
    if (!origin || !username || !password) return Outcome::Error("ERR_TOOL", "hasLogin arguments");
    const auto found = logins.find({*origin, *username});
    return Outcome::Value(JsonValue::Bool(found != logins.end() && found->second.password == *password));
  }
  return std::nullopt;
}

}

int main(int argc, char** argv) {
  if (argc < 4) {
    std::fprintf(stderr, "usage: sync_device_tool <key dir> <default folder> <device name>\n");
    return 2;
  }
  const std::string key_store = argv[1];
  const std::string secret_service = "secret-service:";
  SyncCore core(key_store.starts_with(secret_service) ? MakeSecretServiceKeyStore(key_store.substr(secret_service.size()))
                                                      : MakeFileKeyStore(key_store),
                {argv[2], argv[3]});
  int64_t offset_seconds = 0;
  std::map<LoginKey, StoredLogin> logins;
  std::map<LoginKey, int> attempts;
  std::string line;
  while (std::getline(std::cin, line)) {
    auto request = ParseJson(line);
    JsonValue reply;
    if (!request || !request->Find("method") || !request->Find("args") || !request->Find("args")->is_array()) {
      reply = JsonValue::Object({{"ok", JsonValue::Bool(false)}, {"code", JsonValue::String("ERR_TOOL")}});
    } else {
      const std::string& method = request->Find("method")->text;
      const auto& args = request->Find("args")->items;
      if (method == "Tool.advance" && !args.empty() && args[0].type == JsonValue::Type::kNumber)
        offset_seconds += static_cast<int64_t>(std::strtod(args[0].text.c_str(), nullptr));
      std::optional<Outcome> stored = method == "Tool.advance" ? std::optional<Outcome>(Outcome::Value(JsonValue::Bool(true)))
                                                               : LoginStore(logins, attempts, core, method, args);
      Outcome outcome = stored ? std::move(*stored) : core.Dispatch(method, args, NowSeconds() + offset_seconds);
      reply = outcome.ok ? JsonValue::Object({{"ok", JsonValue::Bool(true)}, {"value", std::move(outcome.value)}})
                         : JsonValue::Object({{"ok", JsonValue::Bool(false)},
                                              {"code", JsonValue::String(outcome.code)},
                                              {"message", JsonValue::String(outcome.message)}});
    }
    std::cout << WriteJson(reply) << std::endl;
  }
  return 0;
}
