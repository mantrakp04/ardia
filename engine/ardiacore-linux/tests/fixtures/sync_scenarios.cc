#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <functional>
#include <map>
#include <sstream>
#include <optional>
#include <random>
#include <string>
#include <string_view>
#include <tuple>
#include <vector>

#include "ardia/linux/ac_linux_policy.h"
#include "ardia/linux/ac_linux_sync.h"
#include "ardia/linux/ac_linux_sync_crypto.h"
#include "ardia/linux/ac_linux_sync_json.h"
#include "ardia/linux/ac_linux_sync_keystore.h"
#include "ardia/linux/ac_linux_sync_vault.h"

using namespace ardia::linux_sync;

namespace {

const std::string& RunSecret() {
  static const std::string secret = [] {
    if (const char* given = std::getenv("ARDIA_FIXTURE_SECRET"); given && *given) return std::string(given);
    std::random_device device;
    std::string made;
    for (int i = 0; i < 16; ++i) made.push_back("0123456789abcdef"[device() % 16]);
    return made;
  }();
  return secret;
}

std::string Fixture(std::string_view label) {
  return RunSecret() + "-" + std::string(label);
}

int failures = 0;

#define CHECK(condition)                                                    \
  do {                                                                      \
    if (!(condition)) {                                                     \
      std::printf("FAILED %s:%d %s\n", __FILE__, __LINE__, #condition);    \
      ++failures;                                                           \
    }                                                                       \
  } while (false)

std::string Hex(const uint8_t* data, size_t size) {
  return HexEncode(Bytes(data, data + size));
}

std::string ReadText(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  std::stringstream buffer;
  buffer << in.rdbuf();
  return buffer.str();
}

void WriteText(const std::string& path, const std::string& text) {
  std::ofstream out(path, std::ios::binary | std::ios::trunc);
  out << text;
}

std::string Trim(std::string text) {
  while (!text.empty() && (text.back() == '\n' || text.back() == '\r' || text.back() == ' ')) text.pop_back();
  return text;
}

std::string Join(const std::vector<std::string>& words) {
  std::string out;
  for (const auto& word : words) {
    if (!out.empty()) out.push_back(' ');
    out += word;
  }
  return out;
}

Bytes Text(std::string_view text) {
  return Bytes(text.begin(), text.end());
}

std::string AsText(const Bytes& bytes) {
  return std::string(bytes.begin(), bytes.end());
}

Bytes Filled(uint8_t byte) {
  return Bytes(kEntropyBytes, byte);
}

class FailingStore final : public KeyStore {
 public:
  std::string_view kind() const override { return "failing"; }
  KeyStatus Load(std::string_view, Bytes*) override { return KeyStatus::kLocked; }
  KeyStatus Save(std::string_view, const Bytes&) override { return KeyStatus::kLocked; }
  KeyStatus Delete(std::string_view) override { return KeyStatus::kLocked; }
  KeyStatus Probe() override { return KeyStatus::kLocked; }
  bool WritesWithoutPrompt() override { return false; }
};

void Wordlist() {
  std::string joined;
  for (size_t i = 0; i < kWordCount; ++i) joined += std::string(kWordlist[i]) + "\n";
  const auto digest = Sha256(reinterpret_cast<const uint8_t*>(joined.data()), joined.size());
  CHECK(Hex(digest.data(), digest.size()) == "2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda");
}

void PhraseVectors() {
  const std::vector<std::pair<uint8_t, std::string>> vectors = {
      {0x00, "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon "
             "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art"},
      {0x7f, "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal "
             "winner thank year wave sausage worth title"},
      {0x80, "letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic "
             "avoid letter advice cage absurd amount doctor acoustic bless"},
      {0xff, "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo vote"},
  };
  for (const auto& [byte, phrase] : vectors) {
    CHECK(Join(PhraseWords(Filled(byte))) == phrase);
    Bytes entropy;
    CHECK(EntropyFromPhrase(phrase, &entropy).kind == PhraseProblem::Kind::kNone);
    CHECK(entropy == Filled(byte));
  }

  std::string kit;
  const auto words = PhraseWords(Filled(0x80));
  for (size_t i = 0; i < words.size(); ++i) {
    std::string upper = words[i];
    for (auto& c : upper) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    kit += std::to_string(i + 1) + ".\xc2\xa0" + upper + (i % 3 == 0 ? ",\n" : "\xe2\x80\x99 ");
  }
  Bytes entropy;
  CHECK(EntropyFromPhrase(kit, &entropy).kind == PhraseProblem::Kind::kNone);
  CHECK(entropy == Filled(0x80));

  std::string prefixes;
  for (const auto& word : words) prefixes += word.substr(0, 4) + " ";
  CHECK(EntropyFromPhrase(prefixes, &entropy).kind == PhraseProblem::Kind::kNone);

  auto count = EntropyFromPhrase("abandon abandon", &entropy);
  CHECK(count.kind == PhraseProblem::Kind::kWordCount && count.count == 2);
  std::string unknown = vectors[0].second;
  unknown.replace(0, 7, "notaword");
  auto bad = EntropyFromPhrase(unknown, &entropy);
  CHECK(bad.kind == PhraseProblem::Kind::kUnknownWord && bad.word == "notaword");
  auto prefix_too_long = EntropyFromPhrase("abandons" + vectors[0].second.substr(7), &entropy);
  CHECK(prefix_too_long.kind == PhraseProblem::Kind::kUnknownWord);
  std::string swapped = vectors[1].second;
  swapped.replace(0, 12, "winner legal");
  CHECK(EntropyFromPhrase(swapped, &entropy).kind == PhraseProblem::Kind::kChecksum);
  auto accented = EntropyFromPhrase("caf\xc3\xa9 " + vectors[0].second.substr(8), &entropy);
  CHECK(accented.kind == PhraseProblem::Kind::kUnknownWord && accented.word == "caf\xc3\xa9");
}

void MacVectors(const std::string& sealed_fixture) {
  const SyncKeys keys(Bytes(kEntropyBytes, 0));
  CHECK(keys.chain_tag() == "gbcx4r55mk3rlaegbggknyx4ta");
  CHECK(keys.ScopeTag("app") == "nr4ncp5iyqzqgjn6ol4zksqtne");
  auto sealed = Base64Decode(Trim(ReadText(sealed_fixture)));
  CHECK(sealed.has_value());
  Bytes payload;
  CHECK(sealed && keys.Open(*sealed, keys.ScopeTag("app"), "f1", &payload) == OpenError::kNone);
  CHECK(AsText(payload) == "from 0.2.32");
  CHECK(sealed && keys.Open(*sealed, keys.ScopeTag("app"), "f2", &payload) == OpenError::kAuthentication);
  std::printf("mac-vector chain %s scope %s\n", keys.chain_tag().c_str(), keys.ScopeTag("app").c_str());
}

void SealAndTamper() {
  auto entropy = NewEntropy();
  CHECK(entropy.has_value());
  const SyncKeys keys(*entropy);
  for (size_t size : {0u, 1019u, 1020u, 1021u, 5000u}) {
    const Bytes payload(size, 'x');
    auto sealed = keys.Seal(payload, "s", "f");
    CHECK(sealed && (sealed->size() - 4 - 12 - 16) % kFilePadding == 0);
    CHECK(sealed && sealed->size() - 32 == (size + 4 + kFilePadding - 1) / kFilePadding * kFilePadding);
    Bytes opened;
    CHECK(sealed && keys.Open(*sealed, "s", "f", &opened) == OpenError::kNone && opened == payload);
  }
  auto sealed = *keys.Seal(Text("bookmark"), "s", "f");
  for (size_t index : {size_t{4}, size_t{10}, size_t{16}, size_t{40}, sealed.size() - 1}) {
    Bytes bad = sealed;
    bad[index] ^= 0x01;
    Bytes out;
    CHECK(keys.Open(bad, "s", "f", &out) == OpenError::kAuthentication);
  }
  Bytes out;
  CHECK(keys.Open(Bytes(sealed.begin(), sealed.begin() + static_cast<long>(sealed.size() / 2)), "s", "f", &out) !=
        OpenError::kNone);
  CHECK(keys.Open(Bytes(sealed.begin(), sealed.begin() + 10), "s", "f", &out) == OpenError::kFormat);
  CHECK(keys.Open(Bytes(), "s", "f", &out) == OpenError::kFormat);
  CHECK(keys.Open(sealed, "s", "g", &out) == OpenError::kAuthentication);
  CHECK(keys.Open(sealed, "t", "f", &out) == OpenError::kAuthentication);
  const SyncKeys other(*NewEntropy());
  CHECK(other.Open(sealed, "s", "f", &out) == OpenError::kAuthentication);
  CHECK(other.chain_tag() != keys.chain_tag());

  auto first = keys.SealPassword(Fixture("bank"), "https://bank.example", "alice@example.com");
  auto second = keys.SealPassword(Fixture("bank"), "https://bank.example", "alice@example.com");
  CHECK(first && second && *first == *second);
  std::string password;
  CHECK(keys.OpenPassword(*first, "https://bank.example", "alice@example.com", &password) == OpenError::kNone);
  CHECK(password == Fixture("bank"));
  CHECK(keys.OpenPassword(*first, "https://evil.example", "alice@example.com", &password) == OpenError::kAuthentication);
  CHECK(keys.OpenPassword(*first, "https://bank.example", "mallory", &password) == OpenError::kAuthentication);
  CHECK(other.OpenPassword(*first, "https://bank.example", "alice@example.com", &password) == OpenError::kAuthentication);
  CHECK(keys.OpenPassword("not base64!", "https://bank.example", "alice@example.com", &password) == OpenError::kFormat);
  auto raw = *Base64Decode(*first);
  raw[0] = 2;
  CHECK(keys.OpenPassword(Base64Encode(raw), "https://bank.example", "alice@example.com", &password) == OpenError::kFormat);
  CHECK(first->find(RunSecret()) == std::string::npos);

  for (const std::string sample : {"", "f", "fo", "foo", "foob", "fooba", "foobar"}) {
    CHECK(AsText(*Base64Decode(Base64Encode(Text(sample)))) == sample);
  }
  CHECK(Base64Encode(Text("foobar")) == "Zm9vYmFy");
  CHECK(!Base64Decode("Zm9vY"));
  CHECK(!Base64Decode("Zm9v=mFy"));
  CHECK(!Base64Decode("Zm=v"));
  CHECK(IsTag(NewFileId()) && NewFileId() != NewFileId());
  CHECK(!IsTag("../aaaaaaaaaaaaaaaaaaaaaaa") && !IsTag("AAAAAAAAAAAAAAAAAAAAAAAAAA"));
}

JsonValue S(std::string text);

JsonValue S(std::string text) {
  return JsonValue::String(std::move(text));
}

void Core(const std::string& scratch) {
  const std::string folder = scratch + "/core-folder";
  SyncCore core(MakeFileKeyStore(scratch + "/core-keys"), {folder, "Test Device"});
  const auto now = NowSeconds();
  auto info = core.Dispatch("ArdiaSync.folderInfo", {JsonValue::Null()}, now);
  CHECK(info.ok && info.value.Find("path")->text == folder && info.value.Find("defaultPath")->text == folder);
  CHECK(info.value.Find("iCloudAvailable")->flag && !info.value.Find("inICloud")->flag && !info.value.Find("exists")->flag);
  CHECK(!core.Dispatch("ArdiaSync.folderInfo", {S("relative")}, now).ok);
  CHECK(core.Dispatch("ArdiaSync.deviceName", {}, now).value.text == "Test Device");
  CHECK(core.Dispatch("ArdiaSync.chainStatus", {S(folder)}, now).code == "locked");
  CHECK(core.Dispatch("ArdiaSync.write", {S(folder), S("app"), S("{}")}, now).code == "locked");
  CHECK(core.Dispatch("ArdiaSync.sealLocal", {S("{}")}, now).code == "locked");
  CHECK(core.Dispatch("ArdiaSync.openLocal", {S("AAAA")}, now).value.type == JsonValue::Type::kNull);
  CHECK(core.Dispatch("ArdiaSync.recoveryWords", {}, now).code == "locked");
  CHECK(core.Dispatch("ArdiaSync.createPhrase", {S("../bad")}, now).code == "ERR_SYNC_ARGUMENT");
  CHECK(core.Dispatch("ArdiaSync.readPasswords", {S("default")}, now).code == "ERR_UNKNOWN_CALL");
  CHECK(core.Dispatch("ArdiaSync.savePassword", {S("default"), S("https://a.example"), S("u"), S("s"), JsonValue::Bool(false)}, now).code ==
        "ERR_UNKNOWN_CALL");
  CHECK(core.Dispatch("ArdiaSync.status", {}, now).value.Find("passwords")->flag);
  CHECK(core.Dispatch("ArdiaSync.nope", {}, now).code == "ERR_UNKNOWN_CALL");

  const std::string device = NewFileId();
  CHECK(core.Dispatch("ArdiaSync.createPhrase", {S(device)}, now).value.flag);
  CHECK(core.unlocked());
  CHECK(core.Dispatch("ArdiaSync.chainStatus", {S(folder)}, now).value.text == "unavailable");
  CHECK(core.Dispatch("ArdiaSync.createChain", {S(folder)}, now).ok);
  CHECK(core.Dispatch("ArdiaSync.chainStatus", {S(folder)}, now).value.text == "ok");
  auto written = core.Dispatch("ArdiaSync.write", {S(folder), S("app"), S("{\"v\":1,\"kind\":\"log\"}")}, now);
  CHECK(written.ok && IsTag(written.value.text));
  auto read = core.Dispatch("ArdiaSync.read", {S(folder), S("app"), JsonValue::Array()}, now);
  CHECK(read.ok && read.value.Find("files")->items.size() == 1);
  CHECK(read.value.Find("files")->items[0].Find("payload")->text == "{\"v\":1,\"kind\":\"log\"}");
  CHECK(!core.Dispatch("ArdiaSync.read", {S(folder), S("app"), S("not a list")}, now).ok);
  auto words = core.Dispatch("ArdiaSync.recoveryWords", {}, now);
  CHECK(words.ok && words.value.items.size() == kPhraseWords);
  std::string phrase;
  for (const auto& word : words.value.items) phrase += word.text + " ";

  auto sealed = core.Dispatch("ArdiaSync.sealLocal", {S("{\"scopes\":{}}")}, now);
  CHECK(sealed.ok && sealed.value.text.find("scopes") == std::string::npos);
  CHECK(core.Dispatch("ArdiaSync.openLocal", {S(sealed.value.text)}, now).value.text == "{\"scopes\":{}}");
  std::string tampered = sealed.value.text;
  tampered[10] = tampered[10] == 'A' ? 'B' : 'A';
  CHECK(core.Dispatch("ArdiaSync.openLocal", {S(tampered)}, now).value.type == JsonValue::Type::kNull);
  CHECK(!core.unreadable());

  SyncCore joiner(MakeFileKeyStore(scratch + "/joiner-keys"), {folder, "Joiner"});
  const std::string joining = NewFileId();
  auto result = joiner.Dispatch("ArdiaSync.enterPhrase", {S(joining), S("abandon abandon"), S(folder)}, now);
  CHECK(result.value.Find("error")->text == "wordCount" && result.value.Find("count")->text == "2");
  result = joiner.Dispatch("ArdiaSync.enterPhrase", {S(joining), S(Join(PhraseWords(Filled(0x7f)))), S(folder)}, now);
  CHECK(result.value.Find("error")->text == "mismatch");
  result = joiner.Dispatch("ArdiaSync.enterPhrase", {S(joining), S(Join(PhraseWords(Filled(0x7f)))), S(scratch + "/empty")}, now);
  CHECK(result.value.Find("error")->text == "noData");
  result = joiner.Dispatch("ArdiaSync.enterPhrase", {S(joining), S("zoo " + phrase), S(folder)}, now);
  CHECK(result.value.Find("error")->text == "wordCount");
  CHECK(!joiner.unlocked());
  SyncCore keyless(std::make_unique<FailingStore>(), {folder, "Keyless"});
  result = keyless.Dispatch("ArdiaSync.enterPhrase", {S(joining), S(phrase), S(folder)}, now);
  CHECK(result.value.Find("error")->text == "keychain");
  CHECK(!keyless.unlocked());
  CHECK(!keyless.Dispatch("ArdiaSync.createPhrase", {S(joining)}, now).value.flag);
  CHECK(keyless.Dispatch("ArdiaSync.status", {}, now).value.Find("keyStoreStatus")->text == "locked");
  result = joiner.Dispatch("ArdiaSync.enterPhrase", {S(joining), S(phrase), S(folder)}, now);
  CHECK(result.value.Find("ok") && result.value.Find("ok")->flag);
  CHECK(joiner.Dispatch("ArdiaSync.read", {S(folder), S("app"), JsonValue::Array()}, now).value.Find("files")->items.size() == 1);

  SyncCore relaunched(MakeFileKeyStore(scratch + "/joiner-keys"), {folder, "Joiner"});
  CHECK(!relaunched.Dispatch("ArdiaSync.unlock", {S(NewFileId())}, now).value.flag);
  CHECK(relaunched.Dispatch("ArdiaSync.unlock", {S(joining)}, now).value.flag);
  CHECK(relaunched.Dispatch("ArdiaSync.openLocal", {S(sealed.value.text)}, now).value.text == "{\"scopes\":{}}");

  auto legacy_plain = std::string("{\"records\":{\"pw:a\":{\"v\":{\"o\":\"https://a.example\",\"u\":\"u\",\"s\":\"AQ==\"}}}}");
  auto legacy_sealed = relaunched.Dispatch("ArdiaSync.sealLocal", {S(legacy_plain)}, now);
  CHECK(legacy_sealed.ok);
  auto legacy_open = relaunched.Dispatch("ArdiaSync.openLocal", {S(legacy_sealed.value.text)}, now);
  CHECK(legacy_open.ok && legacy_open.value.text.find("AQ==") != std::string::npos);
  auto broken = relaunched.Dispatch("ArdiaSync.sealLocal", {S("{\"pw:x\": {\"v\": [")}, now);
  CHECK(broken.ok);
  CHECK(relaunched.Dispatch("ArdiaSync.openLocal", {S(broken.value.text)}, now).value.type == JsonValue::Type::kNull);
  CHECK(relaunched.unreadable());
  CHECK(relaunched.Dispatch("ArdiaSync.write", {S(folder), S("app"), S("{}")}, now).code == "unreadable");
  CHECK(relaunched.Dispatch("ArdiaSync.sealLocal", {S("{}")}, now).code == "unreadable");
  CHECK(relaunched.Dispatch("ArdiaSync.write", {S(folder), S("app"), S("{\"k\":\"pw:x\",\"v\":{\"o\":\"o\",\"u\":\"u\",\"s\":\"AQ==\"}}")}, now).code == "unreadable");

  CHECK(joiner.Dispatch("ArdiaSync.write", {S(folder), S("app"), S("{\"k\":\"pw:x\",\"v\":{\"o\":\"o\",\"u\":\"u\",\"s\":\"AQ==\"}}")}, now).code == "ERR_SYNC_LEGACY");
  const std::string kit_path = scratch + "/" + kKitTextName;
  auto kit = core.SaveKit(kit_path, "October 27, 2026");
  CHECK(kit.ok && kit.value.text == kit_path);
  const std::string kit_text = ReadText(kit_path);
  CHECK(kit_text.find(" 1. " + words.value.items[0].text + "\n") != std::string::npos);
  CHECK(kit_text.find("24. " + words.value.items[23].text + "\n") != std::string::npos);
  CHECK(kit_text.find("Created October 27, 2026 on Test Device") != std::string::npos);
  struct stat kit_info;
  CHECK(stat(kit_path.c_str(), &kit_info) == 0 && (kit_info.st_mode & 0777) == 0600);
  Bytes kit_entropy;
  CHECK(EntropyFromPhrase(kit_text.substr(kit_text.find("Recovery phrase:") + 16, kit_text.find("Keep this kit") - kit_text.find("Recovery phrase:") - 16), &kit_entropy).kind == PhraseProblem::Kind::kNone);

  CHECK(core.Dispatch("ArdiaSync.deleteChain", {S(folder)}, now).ok);
  CHECK(joiner.Dispatch("ArdiaSync.chainStatus", {S(folder)}, now).value.text == "missing");
  const auto generation = core.generation();
  CHECK(core.Dispatch("ArdiaSync.forget", {S(device)}, now).ok);
  CHECK(!core.unlocked() && core.forgotten_since(generation));
  CHECK(core.Dispatch("ArdiaSync.recoveryWords", {}, now).code == "locked");
  CHECK(!core.Dispatch("ArdiaSync.unlock", {S(device)}, now).value.flag);
}

void Lease() {
  AuthorityLease lease;
  CHECK(!lease.Claim("", 0));
  CHECK(lease.Claim("window-a#1", 1000));
  CHECK(lease.Holds("window-a#1", 1000));
  CHECK(!lease.Claim("window-b#1", 2000));
  CHECK(!lease.Holds("window-b#1", 2000));
  CHECK(lease.Claim("window-a#1", 20000));
  CHECK(!lease.Claim("window-b#1", 1000 + kAuthorityLeaseMs + 1));
  lease.Release("window-b#1");
  CHECK(lease.Holds("window-a#1", 21000));
  lease.Release("window-a#1");
  CHECK(!lease.Holds("window-a#1", 21000));
  CHECK(lease.Claim("window-b#1", 21000));
  CHECK(!lease.Holds("window-a#1", 21000));
  CHECK(lease.Claim("window-a#2", 21000 + kAuthorityLeaseMs));
  CHECK(!lease.Holds("window-b#1", 21000 + kAuthorityLeaseMs));
  CHECK(lease.holder() == "window-a#2");
  DisclosureWindow window;
  CHECK(!window.Fresh(0));
  window.Grant(1000);
  CHECK(window.Fresh(1000 + kDisclosureValidityMs - 1) && !window.Fresh(1000 + kDisclosureValidityMs));
  window.Revoke();
  CHECK(!window.Fresh(1001));
  for (const auto& method : kMethods) CHECK(RouteOf(method.name).has_value());
  CHECK(!RouteOf("ArdiaSync.newDeviceId"));
  CHECK(RouteOf("ArdiaSync.write") == Route::kLeased && RouteOf("ArdiaSync.read") == Route::kLeased);
  CHECK(RouteOf("ArdiaSync.folderInfo") == Route::kCore && RouteOf("ArdiaSync.recoveryWords") == Route::kDisclose);
  for (const auto& method : kMethods) std::printf("capability %s\n", method.name);
  CHECK(DefaultFolder("/home/someone") == "/home/someone/Ardia Sync");
  CHECK(DefaultFolder("/home/someone/") == "/home/someone/Ardia Sync");
  CHECK(LossyUtf8(Text("ok\xff\xc3")) == "ok\xef\xbf\xbd\xef\xbf\xbd");
  CHECK(!HostDeviceName().empty());
}


void CrossFormat(const std::string& reference, const std::string& out) {
  const std::string manifest = ReadText(reference + "/manifest.json");
  auto parsed = ParseJson(manifest);
  CHECK(parsed.has_value());
  if (!parsed) return;
  Bytes entropy;
  CHECK(HexDecode(parsed->Find("entropy")->text, &entropy));
  const SyncKeys keys(entropy);
  CHECK(keys.chain_tag() == parsed->Find("chain")->text);
  CHECK(keys.ScopeTag("app") == parsed->Find("appScope")->text);
  CHECK(Join(PhraseWords(entropy)) == parsed->Find("phrase")->text);
  for (const auto& file : parsed->Find("files")->items) {
    const std::string scope = file.Find("scope")->text;
    const std::string id = file.Find("id")->text;
    const std::string path = reference + "/folder/" + keys.chain_tag() + "/" + keys.ScopeTag(scope) + "/" + id + ".nns";
    const std::string data = ReadText(path);
    Bytes opened;
    CHECK(keys.Open(Text(data), keys.ScopeTag(scope), id, &opened) == OpenError::kNone);
    CHECK(AsText(opened) == file.Find("payload")->text);
    Bytes nonce;
    CHECK(HexDecode(file.Find("nonce")->text, &nonce));
    auto resealed = keys.SealWithNonce(opened, keys.ScopeTag(scope), id, nonce.data());
    CHECK(resealed && AsText(*resealed) == data);
  }
  for (const auto& login : parsed->Find("passwords")->items) {
    std::string password;
    CHECK(keys.OpenPassword(login.Find("sealed")->text, login.Find("origin")->text, login.Find("username")->text,
                            &password) == OpenError::kNone);
    CHECK(password == login.Find("password")->text);
    CHECK(keys.SealPassword(password, login.Find("origin")->text, login.Find("username")->text) == login.Find("sealed")->text);
  }
  const Vault vault(out + "/folder", keys);
  CHECK(vault.CreateChain().ok());
  JsonValue written = JsonValue::Array();
  for (const auto& [scope, payload] : std::vector<std::pair<std::string, std::string>>{
           {"app", "{\"v\":1,\"kind\":\"log\",\"device\":\"linux\",\"seq\":1,\"at\":1,\"ops\":[]}"},
           {"p:linux-profile", "{\"v\":1,\"kind\":\"log\",\"device\":\"linux\",\"seq\":1,\"at\":2,\"ops\":[{\"k\":\"bm:secret-bookmark\",\"h\":\"h\",\"v\":{\"title\":\"Linux Secret Title\"}}]}"}}) {
    std::string id;
    CHECK(vault.Write(scope, Text(payload), &id).ok());
    written.Append(JsonValue::Object({{"scope", S(scope)}, {"id", S(id)}, {"payload", S(payload)}}));
  }
  JsonValue passwords = JsonValue::Array();
  auto sealed = keys.SealPassword(Fixture("linux-\xc3\xa9"), "https://linux.example", "tux");
  passwords.Append(JsonValue::Object({{"origin", S("https://linux.example")}, {"username", S("tux")},
                                      {"password", S(Fixture("linux-\xc3\xa9"))}, {"sealed", S(*sealed)}}));
  WriteText(out + "/manifest.json", WriteJson(JsonValue::Object({{"entropy", S(HexEncode(entropy))},
                                                                 {"files", std::move(written)},
                                                                 {"passwords", std::move(passwords)}})));
  std::printf("cross-format reference files opened and Linux files written\n");
}

}

int main(int argc, char** argv) {
  if (argc >= 3) {
    const std::string scratch = argv[1];
    Wordlist();
    PhraseVectors();
    MacVectors(argv[2]);
    SealAndTamper();
    Core(scratch);
    Lease();
    if (argc > 4) CrossFormat(argv[3], argv[4]);
  } else {
    std::printf("usage: sync_scenarios <scratch> <sealed fixture> [reference dir] [output dir]\n");
    return 2;
  }
  if (failures) {
    std::printf("%d sync checks failed\n", failures);
    return 1;
  }
  std::printf("sync scenarios passed\n");
  return 0;
}
