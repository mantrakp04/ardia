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

std::string AccentFixture() {
  return "\xc3\xa9t\xc3\xa9-" + RunSecret();
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

std::vector<std::string> Walk(const std::string& root) {
  std::vector<std::string> paths;
  std::function<void(const std::string&)> visit = [&](const std::string& path) {
    DIR* dir = opendir(path.c_str());
    if (!dir) return;
    while (const dirent* entry = readdir(dir)) {
      const std::string name = entry->d_name;
      if (name == "." || name == "..") continue;
      const std::string child = path + "/" + name;
      paths.push_back(child);
      struct stat info;
      if (lstat(child.c_str(), &info) == 0 && S_ISDIR(info.st_mode)) visit(child);
    }
    closedir(dir);
  };
  visit(root);
  return paths;
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

struct DesktopKeyring {
  bool locked = false;
  bool default_collection_seen = true;
  int saves = 0;
  std::map<std::string, Bytes> items;
};

class DesktopKeyStore final : public KeyStore {
 public:
  explicit DesktopKeyStore(DesktopKeyring* keyring) : keyring_(keyring) {}
  std::string_view kind() const override { return "secretService"; }
  KeyStatus Load(std::string_view account, Bytes* secret) override {
    const auto found = keyring_->items.find(std::string(account));
    if (found == keyring_->items.end()) return KeyStatus::kNotFound;
    if (keyring_->locked) return KeyStatus::kLocked;
    *secret = found->second;
    return KeyStatus::kOk;
  }
  KeyStatus Save(std::string_view account, const Bytes& secret) override {
    ++keyring_->saves;
    if (keyring_->locked) return KeyStatus::kLocked;
    keyring_->items[std::string(account)] = secret;
    return KeyStatus::kOk;
  }
  KeyStatus Delete(std::string_view account) override {
    return keyring_->items.erase(std::string(account)) ? KeyStatus::kOk : KeyStatus::kNotFound;
  }
  KeyStatus Probe() override { return keyring_->locked ? KeyStatus::kLocked : KeyStatus::kOk; }
  bool WritesWithoutPrompt() override { return !keyring_->locked && keyring_->default_collection_seen; }

 private:
  DesktopKeyring* keyring_;
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

void VaultScenarios(const std::string& scratch) {
  const std::string folder = scratch + "/Ardia Sync";
  const Bytes entropy = *NewEntropy();
  const SyncKeys keys(entropy);
  const Vault vault(folder, keys);
  CHECK(vault.CreateChain().ok());
  CHECK(vault.ChainExists());
  CHECK(HasSyncData(folder));
  const std::vector<std::string> secrets = {"https://secret-bank.example/login", "Quarterly Plans", Fixture("bank"),
                                            "alice@example.com"};
  std::string payload = "{\"secrets\":[";
  for (const auto& secret : secrets) payload += "\"" + secret + "\",";
  payload += "\"end\"]}";
  std::string id;
  CHECK(vault.Write("p:default", Text(payload), &id).ok());
  CHECK(IsTag(id));
  std::string second;
  CHECK(vault.Write("app", Text("{\"v\":1}"), &second).ok());
  for (const auto& path : Walk(folder)) {
    const std::string relative = path.substr(folder.size());
    std::string name = relative.substr(relative.find_last_of('/') + 1);
    if (name.size() > 4 && name.substr(name.size() - 4) == ".nns") name = name.substr(0, name.size() - 4);
    CHECK(IsTag(name));
    for (const auto& secret : secrets) CHECK(relative.find(secret) == std::string::npos);
    CHECK(relative.find("default") == std::string::npos && relative.find("app") == std::string::npos);
    struct stat info;
    if (lstat(path.c_str(), &info) == 0 && S_ISREG(info.st_mode)) {
      CHECK((info.st_mode & 0777) == 0600);
      const std::string contents = ReadText(path);
      CHECK(contents.substr(0, 4) == "NNS1");
      CHECK((contents.size() - 32) % kFilePadding == 0);
      for (const auto& secret : secrets) CHECK(contents.find(secret) == std::string::npos);
    }
  }

  Listing listing = vault.Read("p:default", {}, NowSeconds());
  CHECK(listing.files.size() == 1 && listing.files[0].id == id && AsText(listing.files[0].payload) == payload);
  CHECK(listing.present.size() == 1 && listing.damaged.empty() && listing.pending.empty());
  listing = vault.Read("p:default", {id}, NowSeconds());
  CHECK(listing.files.empty() && listing.present.size() == 1);

  const std::string scope = vault.ScopePath("p:default");
  const std::string stale = scope + "/" + kStagingPrefix + "leftover";
  WriteText(stale, "half written");
  struct timespec old_times[2] = {{NowSeconds() - 2 * kStaleStagingSeconds, 0}, {NowSeconds() - 2 * kStaleStagingSeconds, 0}};
  utimensat(AT_FDCWD, stale.c_str(), old_times, 0);
  const std::string fresh = scope + "/" + kStagingPrefix + "inflight";
  WriteText(fresh, "being written");
  const std::string truncated_id = NewFileId();
  const std::string whole = ReadText(scope + "/" + id + ".nns");
  WriteText(scope + "/" + truncated_id + ".nns", whole.substr(0, whole.size() / 2));
  utimensat(AT_FDCWD, (scope + "/" + truncated_id + ".nns").c_str(), old_times, 0);
  const std::string empty_id = NewFileId();
  WriteText(scope + "/" + empty_id + ".nns", "");
  const std::string waiting_id = NewFileId();
  WriteText(scope + "/.syncthing." + waiting_id + ".nns.tmp", "partial");
  WriteText(scope + "/.syncthing." + id + ".nns.tmp", "stale temp for a whole file");
  WriteText(scope + "/" + id + " (conflicted copy).nns", whole);
  WriteText(scope + "/" + id + ".sync-conflict-20261027-000000-ABCDEFG.nns", whole);
  WriteText(scope + "/notes.txt", "ignored");
  const std::string renamed_id = NewFileId();
  WriteText(scope + "/" + renamed_id + ".nns", whole);
  std::string moved_id;
  CHECK(vault.Write("app", Text("{\"moved\":true}"), &moved_id).ok());
  const std::string moved_whole = ReadText(vault.ScopePath("app") + "/" + moved_id + ".nns");
  WriteText(scope + "/" + moved_id + ".nns", moved_whole);

  const SyncKeys restarted_keys(entropy);
  const Vault restarted(folder, restarted_keys);
  listing = restarted.Read("p:default", {}, NowSeconds());
  CHECK(listing.files.size() == 1 && listing.files[0].id == id);
  CHECK(listing.pending.size() == 1 && listing.pending[0] == waiting_id);
  CHECK(listing.damaged.size() == 4);
  bool truncated_aged = false;
  for (const auto& entry : listing.damaged) {
    CHECK(entry.id == truncated_id || entry.id == empty_id || entry.id == renamed_id || entry.id == moved_id);
    if (entry.id == truncated_id) truncated_aged = entry.age_seconds >= kStaleStagingSeconds;
  }
  CHECK(truncated_aged);
  CHECK(listing.present.size() == 6);

  std::string third;
  CHECK(vault.Write("p:default", Text("{\"third\":1}"), &third).ok());
  CHECK(access(stale.c_str(), F_OK) != 0);
  CHECK(access(fresh.c_str(), F_OK) == 0);

  const std::string outside = scratch + "/outside.nns";
  WriteText(outside, "keep me");
  vault.Remove("p:default", {"../../outside", "../outside", truncated_id, empty_id});
  CHECK(access(outside.c_str(), F_OK) == 0);
  CHECK(access((scope + "/" + truncated_id + ".nns").c_str(), F_OK) != 0);
  CHECK(access((scope + "/" + empty_id + ".nns").c_str(), F_OK) != 0);

  const SyncKeys other_keys(*NewEntropy());
  const Vault other(folder, other_keys);
  CHECK(other.CreateChain().ok());
  std::string theirs;
  CHECK(other.Write("app", Text("theirs"), &theirs).ok());
  const std::string victim = scratch + "/victim";
  mkdir(victim.c_str(), 0700);
  WriteText(victim + "/precious", "precious");
  CHECK(symlink(victim.c_str(), (scope + "/link").c_str()) == 0);
  CHECK(vault.DeleteChain().ok());
  CHECK(!vault.ChainExists());
  CHECK(access((victim + "/precious").c_str(), F_OK) == 0);
  CHECK(other.Read("app", {}, NowSeconds()).files.size() == 1);
  CHECK(!ValidFolderPath("relative/path") && !ValidFolderPath("") && ValidFolderPath("/tmp/x"));
  const FolderFacts facts = InspectFolder(folder);
  CHECK(facts.exists && facts.writable && facts.has_sync_data);
  CHECK(!InspectFolder(scratch + "/missing").exists);
}

void LegacyPasswords() {
  const SyncKeys keys(*NewEntropy());
  const std::string document =
      "{\"v\":1,\"kind\":\"snapshot\",\"device\":\"d\",\"at\":1790000000000,\"vv\":{\"d\":3},\"seen\":{},"
      "\"records\":{\"pw:https://bank.example\\nalice\":{\"h\":\"h1\",\"v\":{\"o\":\"https://bank.example\","
      "\"u\":\"alice\",\"p\":\"" + Fixture("bank") + "\"},\"o\":[\"d\",1]},\"bm:1\":{\"h\":\"h2\",\"v\":{\"t\":\"caf\\u00e9 "
      "\\ud83d\\ude00 \\ud800 tail\",\"n\":1.50e3},\"o\":[\"d\",2]}},"
      "\"ops\":[{\"k\":\"pw:https://mail.example\\nbob\",\"h\":\"h3\",\"v\":{\"o\":\"https://mail.example\","
      "\"u\":\"bob\",\"p\":\"" + Fixture("mail") + "\"}}],\"base\":{\"pw:https://bank.example\\nalice\":\"{\\\"p\\\":\\\"x\\\"}\","
      "\"bm:1\":\"{}\"}}";
  CHECK(HasLegacyPasswords(document));
  auto hidden = HideLegacyPasswords(document, keys);
  CHECK(hidden.has_value());
  CHECK(hidden->find(Fixture("bank")) == std::string::npos);
  CHECK(hidden->find(Fixture("mail")) == std::string::npos);
  CHECK(hidden->find("\\\"p\\\"") == std::string::npos);
  auto tree = ParseJson(*hidden);
  CHECK(tree && tree->Find("records") && tree->Find("records")->Find("pw:https://bank.example\nalice"));
  const JsonValue* login = tree->Find("records")->Find("pw:https://bank.example\nalice")->Find("v");
  CHECK(login && !login->Find("p") && login->Find("s") && login->Find("s")->is_string());
  CHECK(tree->Find("base")->Find("bm:1") && !tree->Find("base")->Find("pw:https://bank.example\nalice"));
  const JsonValue* title = tree->Find("records")->Find("bm:1")->Find("v")->Find("t");
  CHECK(title && title->text == "caf\xc3\xa9 \xf0\x9f\x98\x80 \xef\xbf\xbd tail");
  CHECK(hidden->find("1.50e3") != std::string::npos);
  auto restored = RestoreLegacyPasswords(*hidden, keys);
  CHECK(restored && restored->find(Fixture("bank")) != std::string::npos &&
        restored->find(Fixture("mail")) != std::string::npos);
  auto again = HideLegacyPasswords(*restored, keys);
  CHECK(again && *again == *hidden);
  const SyncKeys other(*NewEntropy());
  CHECK(!RestoreLegacyPasswords(*hidden, other));
  CHECK(!HideLegacyPasswords("{\"pw:x\": [", keys));
  const std::string plain = "{\"k\":\"bm:1\",\"v\":{\"p\":\"not a password\"}}";
  CHECK(HideLegacyPasswords(plain, keys) == plain);
  std::string deep = "\"pw:";
  for (int i = 0; i < 1000; ++i) deep = "[" + deep;
  CHECK(!ParseJson(deep));
  CHECK(!ParseJson("{\"a\":\"\x01\"}"));
  CHECK(!ParseJson("{\"a\":\"\xff\"}"));
  CHECK(WriteJson(*ParseJson("{\"a\":[1,-2.5e-3,true,null,\"\\n\\u0001/\"]}")) == "{\"a\":[1,-2.5e-3,true,null,\"\\n\\u0001/\"]}");
}

JsonValue S(std::string text);

void HeldKeyAcrossWindows(const std::string& scratch) {
  const std::string folder = scratch + "/held-key-folder";
  const std::string device = NewFileId();
  const std::string other = NewFileId();
  DesktopKeyring keyring;
  std::string phrase;
  {
    SyncCore first(std::make_unique<DesktopKeyStore>(&keyring), {folder, "First"});
    CHECK(first.Dispatch("ArdiaSync.createPhrase", {S(device)}, 0).value.flag);
    CHECK(first.Dispatch("ArdiaSync.createChain", {S(folder)}, 0).ok);
    for (const auto& word : first.Dispatch("ArdiaSync.recoveryWords", {}, 0).value.items)
      phrase += (phrase.empty() ? "" : " ") + word.text;
  }
  const Bytes stored = keyring.items[device];
  keyring.locked = true;
  SyncCore core(std::make_unique<DesktopKeyStore>(&keyring), {folder, "Locked"});
  int64_t now = 1000;
  CHECK(!core.Dispatch("ArdiaSync.unlock", {S(device)}, now).value.flag);
  CHECK(core.Dispatch("ArdiaSync.enterPhrase", {S(device), S(phrase), S(folder)}, now).value.Find("ok"));
  const int saves = keyring.saves;
  CHECK(core.Dispatch("ArdiaSync.unlock", {S(device)}, now + 5).value.flag);
  CHECK(!core.Dispatch("ArdiaSync.unlock", {S(other)}, now + 5).value.flag);
  CHECK(core.Dispatch("ArdiaSync.enterPhrase", {S(device), S(""), S(folder)}, now + 5).value.Find("ok"));
  CHECK(core.Dispatch("ArdiaSync.enterPhrase", {S(other), S(""), S(folder)}, now + 5).value.Find("error"));
  CHECK(core.unlocked());
  keyring.locked = false;
  keyring.default_collection_seen = false;
  CHECK(core.Dispatch("ArdiaSync.status", {}, now + 40).value.Find("unlocked")->flag);
  CHECK(keyring.saves == saves);
  keyring.default_collection_seen = true;
  auto status = core.Dispatch("ArdiaSync.status", {}, now + 80);
  CHECK(keyring.saves == saves + 1 && status.value.Find("lastKeyStatus")->text == "ok");
  CHECK(keyring.items[device] == stored);
  CHECK(core.Dispatch("ArdiaSync.status", {}, now + 200).ok && keyring.saves == saves + 1);
  std::printf("held key: a second window unlocks from memory, the save waits for an open default collection\n");
}

void HeldKeyStaysWithItsDevice(const std::string& scratch) {
  const std::string folder = scratch + "/held-key-a";
  const std::string folder_b = scratch + "/held-key-b";
  const std::string device = NewFileId();
  const std::string other = NewFileId();
  DesktopKeyring keyring;
  std::string phrase;
  {
    SyncCore first(std::make_unique<DesktopKeyStore>(&keyring), {folder, "First"});
    CHECK(first.Dispatch("ArdiaSync.createPhrase", {S(device)}, 0).value.flag);
    CHECK(first.Dispatch("ArdiaSync.createChain", {S(folder)}, 0).ok);
    for (const auto& word : first.Dispatch("ArdiaSync.recoveryWords", {}, 0).value.items)
      phrase += (phrase.empty() ? "" : " ") + word.text;
    CHECK(first.Dispatch("ArdiaSync.createPhrase", {S(other)}, 0).value.flag);
    CHECK(first.Dispatch("ArdiaSync.createChain", {S(folder_b)}, 0).ok);
  }
  const Bytes stored = keyring.items[device];
  const Bytes stored_other = keyring.items[other];
  CHECK(stored != stored_other);
  keyring.locked = true;
  SyncCore core(std::make_unique<DesktopKeyStore>(&keyring), {folder, "Locked"});
  int64_t now = 1000;
  CHECK(!core.Dispatch("ArdiaSync.unlock", {S(device)}, now).value.flag);
  CHECK(core.Dispatch("ArdiaSync.enterPhrase", {S(device), S(phrase), S(folder)}, now).value.Find("ok"));
  CHECK(core.Dispatch("ArdiaSync.status", {}, now + 1).ok);
  keyring.locked = false;
  CHECK(core.Dispatch("ArdiaSync.unlock", {S(other)}, now + 5).value.flag);
  for (int64_t later = now + 40; later <= now + 200; later += 40) CHECK(core.Dispatch("ArdiaSync.status", {}, later).ok);
  CHECK(keyring.items[device] == stored);
  CHECK(keyring.items[other] == stored_other);
  std::printf("held key: another device's key is never saved under the held device\n");
}

void SecretServiceWithoutBus(const std::string& library) {
  auto secret_service = MakeSecretServiceKeyStore(library);
  const std::string account = NewFileId();
  const Bytes secret = *NewEntropy();
  Bytes loaded;
  CHECK(secret_service->kind() == "secretService");
  CHECK(secret_service->Probe() == KeyStatus::kUnavailable);
  CHECK(secret_service->Load(account, &loaded) == KeyStatus::kUnavailable);
  CHECK(secret_service->Save(account, secret) == KeyStatus::kUnavailable);
  CHECK(secret_service->Delete(account) == KeyStatus::kUnavailable);
  std::printf("secret service without a bus: unavailable\n");
}

void KeyStores(const std::string& scratch) {
  auto store = MakeFileKeyStore(scratch + "/keys");
  const std::string account = NewFileId();
  Bytes loaded;
  CHECK(store->Load(account, &loaded) == KeyStatus::kNotFound);
  const Bytes secret = *NewEntropy();
  CHECK(store->Save(account, secret) == KeyStatus::kOk);
  CHECK(store->Load(account, &loaded) == KeyStatus::kOk && loaded == secret);
  struct stat info;
  CHECK(stat((scratch + "/keys/sync-key-" + account).c_str(), &info) == 0 && (info.st_mode & 0777) == 0600);
  CHECK(stat((scratch + "/keys").c_str(), &info) == 0 && (info.st_mode & 0777) == 0700);
  CHECK(store->Save("../escape", secret) == KeyStatus::kUnavailable);
  CHECK(store->Load("../escape", &loaded) == KeyStatus::kNotFound);
  const std::string linked = NewFileId();
  WriteText(scratch + "/target", "not a key");
  CHECK(symlink((scratch + "/target").c_str(), (scratch + "/keys/sync-key-" + linked).c_str()) == 0);
  CHECK(store->Load(linked, &loaded) == KeyStatus::kUnavailable);
  CHECK(store->Delete(account) == KeyStatus::kOk);
  CHECK(store->Load(account, &loaded) == KeyStatus::kNotFound);

  auto missing = MakeSecretServiceKeyStore(scratch + "/no-such-libsecret.so");
  CHECK(missing->Probe() == KeyStatus::kUnavailable);
  CHECK(missing->Save(account, secret) == KeyStatus::kUnavailable);
  CHECK(missing->Load(account, &loaded) == KeyStatus::kUnavailable);
  CHECK(HexEncode(Text("\x01\xab")) == "01ab");
  Bytes decoded;
  CHECK(HexDecode("01AB", &decoded) && decoded == Text("\x01\xab"));
  CHECK(!HexDecode("0g", &decoded) && !HexDecode("abc", &decoded));
}

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

std::string race_victim;
std::string race_parked;

void SwapForLink(const std::string& path) {
  if (path.size() < 5 || path.substr(path.size() - 5) != "/swap") return;
  CHECK(rename(path.c_str(), race_parked.c_str()) == 0);
  CHECK(symlink(race_victim.c_str(), path.c_str()) == 0);
}

void DeleteRace(const std::string& scratch) {
  const std::string folder = scratch + "/race-folder";
  const SyncKeys keys(*NewEntropy());
  const Vault vault(folder, keys);
  CHECK(vault.CreateChain().ok());
  std::string id;
  CHECK(vault.Write("app", Text("{}"), &id).ok());
  const std::string swap = vault.ScopePath("app") + "/swap";
  CHECK(mkdir(swap.c_str(), 0700) == 0);
  WriteText(swap + "/inner", "inner");
  race_victim = scratch + "/race-home";
  race_parked = scratch + "/race-parked";
  CHECK(mkdir(race_victim.c_str(), 0700) == 0);
  WriteText(race_victim + "/precious", "precious");
  SetRemoveTreeHookForTesting(&SwapForLink);
  vault.DeleteChain();
  SetRemoveTreeHookForTesting(nullptr);
  CHECK(access((race_victim + "/precious").c_str(), F_OK) == 0);
  CHECK(!vault.ChainExists());
}

void SymlinkedChain(const std::string& scratch) {
  const std::string folder = scratch + "/linked-folder";
  const SyncKeys keys(*NewEntropy());
  const std::string elsewhere = scratch + "/linked-elsewhere";
  const Vault real(elsewhere, keys);
  CHECK(real.CreateChain().ok());
  std::string id;
  CHECK(real.Write("app", Text("{\"elsewhere\":true}"), &id).ok());
  const std::string target = real.ScopePath("app") + "/" + id + ".nns";
  CHECK(mkdir(folder.c_str(), 0700) == 0);
  const Vault linked(folder, keys);
  CHECK(symlink(real.ChainPath().c_str(), linked.ChainPath().c_str()) == 0);
  CHECK(!linked.ChainExists());
  CHECK(linked.Read("app", {}, NowSeconds()).present.empty());
  linked.Remove("app", {id});
  CHECK(access(target.c_str(), F_OK) == 0);
  std::string written;
  CHECK(!linked.Write("app", Text("{}"), &written).ok());
  CHECK(real.Read("app", {}, NowSeconds()).files.size() == 1);
  CHECK(linked.DeleteChain().ok());
  CHECK(access(target.c_str(), F_OK) == 0);
  CHECK(real.ChainExists());

  const std::string scoped_folder = scratch + "/linked-scope";
  const Vault scoped(scoped_folder, keys);
  CHECK(scoped.CreateChain().ok());
  CHECK(symlink(real.ScopePath("app").c_str(), scoped.ScopePath("app").c_str()) == 0);
  CHECK(scoped.Read("app", {}, NowSeconds()).present.empty());
  scoped.Remove("app", {id});
  CHECK(access(target.c_str(), F_OK) == 0);
  CHECK(!scoped.Write("app", Text("{}"), &written).ok());
  CHECK(scoped.DeleteChain().ok());
  CHECK(access(target.c_str(), F_OK) == 0);
}

void LargeJson() {
  std::string json = "{";
  for (int i = 0; i < 100000; ++i) json += (i ? ",\"k" : "\"k") + std::to_string(i) + "\":" + std::to_string(i);
  json += ",\"k5\":\"last\"}";
  const auto start = std::chrono::steady_clock::now();
  auto parsed = ParseJson(json);
  const auto seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count();
  CHECK(parsed && parsed->members.size() == 100000);
  CHECK(parsed && parsed->Find("k5") && parsed->Find("k5")->text == "last");
  CHECK(parsed && parsed->members.back().first == "k5");
  CHECK(seconds < 3.0);
  std::printf("parsed 100000 keys in %.2f s\n", seconds);
}

void KeyFileModes(const std::string& scratch) {
  auto store = MakeFileKeyStore(scratch + "/mode-keys");
  const std::string account = NewFileId();
  const Bytes secret = *NewEntropy();
  CHECK(store->Save(account, secret) == KeyStatus::kOk);
  const std::string path = scratch + "/mode-keys/sync-key-" + account;
  Bytes loaded;
  CHECK(chmod(path.c_str(), 0644) == 0);
  CHECK(store->Load(account, &loaded) == KeyStatus::kUnavailable);
  CHECK(chmod(path.c_str(), 0640) == 0);
  CHECK(store->Load(account, &loaded) == KeyStatus::kUnavailable);
  CHECK(chmod(path.c_str(), 0600) == 0);
  CHECK(store->Load(account, &loaded) == KeyStatus::kOk && loaded == secret);
}

void KeyStorePolicy() {
  CHECK(ClassifySecretError("secret-error", 2) == KeyStatus::kLocked);
  CHECK(ClassifySecretError("g-io-error-quark", 19) == KeyStatus::kLocked);
  CHECK(ClassifySecretError("g-dbus-error-quark", 2) == KeyStatus::kUnavailable);
  CHECK(ClassifySecretError("secret-error", 1) == KeyStatus::kUnavailable);
  CHECK(UseFileKeyStore(true, true, "/tmp/ardia-test-profile", "/home/u/.config/ardia"));
  CHECK(!UseFileKeyStore(false, true, "/tmp/ardia-test-profile", "/home/u/.config/ardia"));
  CHECK(!UseFileKeyStore(true, false, "/tmp/ardia-test-profile", "/home/u/.config/ardia"));
  CHECK(!UseFileKeyStore(true, true, "/home/u/.config/ardia", "/home/u/.config/ardia"));
  CHECK(!UseFileKeyStore(true, true, "/home/u/.config/ardia/", "/home/u/.config/ardia"));
  CHECK(!UseFileKeyStore(true, true, "", "/home/u/.config/ardia"));
  CHECK(!UseFileKeyStore(true, true, "relative", "/home/u/.config/ardia"));
  const ClipboardWrite write = PhraseClipboard("legal winner thank");
  CHECK(write.text == "legal winner thank");
  CHECK(write.confidential);
  CHECK(write.raw.size() == 1 && write.raw[0].first == "x-kde-passwordManagerHint" && write.raw[0].second == "secret");
}

}

LoginRead Logins(bool complete, std::vector<std::tuple<std::string, std::string, std::string, double>> rows) {
  LoginRead read;
  read.complete = complete;
  for (auto& [realm, username, password, created] : rows) read.logins.emplace_back(realm, username, std::move(password), created);
  return read;
}

void LargeLocalState(const std::string& scratch) {
  SyncCore core(MakeFileKeyStore(scratch + "/large-keys"), {scratch + "/large-folder", "Large Device"});
  CHECK(core.Dispatch("ArdiaSync.createPhrase", {S(NewFileId())}, NowSeconds()).value.flag);
  std::string state = "{\"covers\":3,\"scopes\":{\"app\":\"";
  while (state.size() < 12u * 1024 * 1024) state += "history-entry-0123456789abcdef-";
  state += "\"}}";
  auto sealed = core.Dispatch("ArdiaSync.sealLocal", {S(state)}, NowSeconds());
  CHECK(sealed.ok && sealed.value.text.size() > ardia::linux_policy::kDocumentLimit);
  CHECK(sealed.value.text.size() <= ardia::linux_policy::DocumentLimit(ardia::linux_policy::kSyncStateDocument));
  CHECK(core.Dispatch("ArdiaSync.openLocal", {S(sealed.value.text)}, NowSeconds()).value.text == state);
  std::printf("large local state: %zu sealed bytes round trip\n", sealed.value.text.size());
}

void SealedLogins(const std::string& scratch) {
  CHECK(LoginOrigin("https://bank.example/") == std::optional<std::string>("https://bank.example"));
  CHECK(LoginOrigin("http://intranet.example:8080") == std::optional<std::string>("http://intranet.example:8080"));
  CHECK(!LoginOrigin("https://bank.example/realm"));
  CHECK(!LoginOrigin("android://hash@com.example.app/"));
  CHECK(!LoginOrigin("ftp://files.example"));
  CHECK(!LoginOrigin("https://two words.example"));
  CHECK(!LoginOrigin("https://"));
  CHECK(!LoginOrigin(""));
  CHECK(!LoginOrigin("https://bank.example\n"));
  CHECK(!LoginOrigin(std::string("https://") + std::string(kMaxLoginOriginBytes, 'a')));

  CHECK(ReadPasswordsProfile({S("default")}) == std::optional<std::string>("default"));
  CHECK(!ReadPasswordsProfile({}));
  CHECK(!ReadPasswordsProfile({JsonValue::Number(1)}));
  CHECK(!ReadPasswordsProfile({S("")}));
  CHECK(!ReadPasswordsProfile({S(std::string(kMaxProfileBytes + 1, 'p'))}));
  auto save = ParsePasswordSave({S("default"), S("https://bank.example"), S("alice"), S("AAAA"), JsonValue::Bool(true)});
  CHECK(save && save->profile == "default" && save->origin == "https://bank.example" && save->username == "alice" &&
        save->sealed == "AAAA" && save->replacing && save->holdable);
  CHECK(ParsePasswordSave({S("default"), S("https://bank.example"), S(""), S("AAAA"), JsonValue::Bool(false)}));
  auto pathed = ParsePasswordSave({S("default"), S("https://bank.example/path"), S("alice"), S("AAAA"), JsonValue::Bool(false)});
  CHECK(pathed && !pathed->holdable);
  CHECK(!ParsePasswordSave({S("default"), S("https://bank.example"), S("alice"), S("AAAA"), S("yes")}));
  CHECK(!ParsePasswordSave({S("default"), S("https://bank.example"), S("alice"), S("AAAA")}));
  auto long_username = ParsePasswordSave({S("default"), S("https://bank.example"), S(std::string(kMaxLoginUsernameBytes + 1, 'u')),
                                          S("AAAA"), JsonValue::Bool(false)});
  CHECK(long_username && !long_username->holdable);
  CHECK(!ParsePasswordSave({S("default"), S("https://bank.example"), S(std::string(kMaxSyncedFieldBytes + 1, 'u')), S("AAAA"),
                            JsonValue::Bool(false)}));
  CHECK(!ParsePasswordSave({S("default"), S(std::string(kMaxSyncedFieldBytes + 1, 'o')), S("alice"), S("AAAA"),
                            JsonValue::Bool(false)}));
  CHECK(kMaxLoginPasswordBytes == 65536 && kMaxSealedPasswordBytes >= 4 * (1 + kNonceBytes + kMaxLoginPasswordBytes + 36 + 2) / 3);
  CHECK(!ParsePasswordSave({S("default"), S("https://bank.example"), S("alice"), S(std::string(kMaxSealedPasswordBytes + 1, 'A')),
                            JsonValue::Bool(false)}));
  CHECK(!ParsePasswordSave({JsonValue::Null(), S("https://bank.example"), S("alice"), S("AAAA"), JsonValue::Bool(false)}));

  StoredLogin moved("https://bank.example", "alice", Fixture("moved"), 0);
  StoredLogin target(std::move(moved));
  CHECK(moved.password.empty() && target.password == Fixture("moved"));

  SyncCore core(MakeFileKeyStore(scratch + "/login-keys"), {scratch + "/login-folder", "Login Device"});
  const auto rows = [] {
    return Logins(true, {{"https://bank.example/", "alice@example.com", Fixture("bank"), 1700000000000.5},
                         {"https://bank.example", "alice@example.com", Fixture("duplicate"), 1},
                         {"https://bank.example/", "", AccentFixture(), 2},
                         {"https://shop.example/", "bob", "", 3},
                         {"https://shop.example/basic-realm", "bob", Fixture("realm"), 4},
                         {"android://hash@com.example.app/", "bob", Fixture("android"), 5},
                         {"http://intranet.example:8080/", "carol", Fixture("intranet"), 0}});
  };
  CHECK(core.SealLogins(rows()).value.type == JsonValue::Type::kNull);
  const PasswordSave locked{"default", "https://bank.example", "alice@example.com", "AAAA", false};
  CHECK(!core.OpenLogin(locked));
  CHECK(core.Dispatch("ArdiaSync.createPhrase", {S(NewFileId())}, NowSeconds()).value.flag);
  CHECK(core.SealLogins(Logins(false, {{"https://bank.example/", "alice@example.com", Fixture("bank"), 1}})).value.type ==
        JsonValue::Type::kNull);
  Outcome sealed = core.SealLogins(rows());
  CHECK(sealed.ok && sealed.value.is_array() && sealed.value.items.size() == 3);
  const std::string text = WriteJson(sealed.value);
  CHECK(text.find(RunSecret()) == std::string::npos);
  CHECK(text == WriteJson(core.SealLogins(rows()).value));
  struct Expected {
    const char* origin;
    const char* username;
    std::string password;
    double created;
  };
  const Expected expected[] = {{"https://bank.example", "alice@example.com", Fixture("bank"), 1700000000000.5},
                               {"https://bank.example", "", AccentFixture(), 2},
                               {"http://intranet.example:8080", "carol", Fixture("intranet"), 0}};
  for (size_t i = 0; i < sealed.value.items.size() && i < 3; ++i) {
    const JsonValue& login = sealed.value.items[i];
    CHECK(login.members.size() == 4);
    CHECK(login.Find("origin")->text == expected[i].origin && login.Find("username")->text == expected[i].username);
    CHECK(std::strtod(login.Find("created")->text.c_str(), nullptr) == expected[i].created);
    PasswordSave request{"default", expected[i].origin, expected[i].username, login.Find("sealed")->text, false};
    auto opened = core.OpenLogin(request);
    CHECK(opened && opened->password == expected[i].password && opened->realm == expected[i].origin &&
          opened->username == expected[i].username);
    request.username = std::string(expected[i].username) + "x";
    CHECK(!core.OpenLogin(request));
    request.username = expected[i].username;
    request.origin = "https://evil.example";
    CHECK(!core.OpenLogin(request));
    request.origin = expected[i].origin;
    request.sealed[request.sealed.size() / 2] = request.sealed[request.sealed.size() / 2] == 'A' ? 'B' : 'A';
    CHECK(!core.OpenLogin(request));
    request.sealed = "not base64!";
    CHECK(!core.OpenLogin(request));
  }
  const std::string long_password(20000, 'L');
  Outcome long_sealed = core.SealLogins(Logins(true, {{"https://long.example/", "lee", std::string(long_password), 0},
                                                      {"https://huge.example/", "hugh", std::string(kMaxLoginPasswordBytes + 1, 'H'), 0}}));
  CHECK(long_sealed.ok && long_sealed.value.items.size() == 1 && long_sealed.value.items[0].Find("sealed")->text.size() > 16384);
  Outcome long_usernames = core.SealLogins(Logins(true, {{"https://site.example/", std::string(2000, 'u'), "pw", 0},
                                                         {"https://site.example/", std::string(kMaxSyncedFieldBytes + 1, 'v'), "pw", 0}}));
  CHECK(long_usernames.ok && long_usernames.value.items.empty());
  Outcome kib_username = core.SealLogins(Logins(true, {{"https://site.example/", std::string(kMaxLoginUsernameBytes, 'u'), "pw", 0}}));
  CHECK(kib_username.ok && kib_username.value.items.size() == 1);
  auto long_save = ParsePasswordSave({S("default"), S("https://long.example"), S("lee"), S(long_sealed.value.items[0].Find("sealed")->text),
                                      JsonValue::Bool(false)});
  CHECK(long_save && long_save->holdable);
  auto long_opened = long_save ? core.OpenLogin(*long_save) : std::nullopt;
  CHECK(long_opened && long_opened->password == long_password);
  PasswordSave before_forget{"default", "https://bank.example", "alice@example.com", sealed.value.items[0].Find("sealed")->text, false};
  CHECK(core.OpenLogin(before_forget));
  core.Dispatch("ArdiaSync.forget", {}, NowSeconds());
  CHECK(!core.OpenLogin(before_forget));
  CHECK(core.SealLogins(rows()).value.type == JsonValue::Type::kNull);
  std::printf("sealed logins: %zu sealed, partial and locked reads refused\n", sealed.value.items.size());
}

int main(int argc, char** argv) {
  if (argc == 3 && std::string(argv[1]) == "--secret-service") {
    SecretServiceWithoutBus(argv[2]);
  } else if (argc >= 3) {
    const std::string scratch = argv[1];
    Wordlist();
    PhraseVectors();
    MacVectors(argv[2]);
    SealAndTamper();
    VaultScenarios(scratch);
    LegacyPasswords();
    KeyStores(scratch);
    Core(scratch);
    HeldKeyAcrossWindows(scratch);
    HeldKeyStaysWithItsDevice(scratch);
    SealedLogins(scratch);
    LargeLocalState(scratch);
    Lease();
    DeleteRace(scratch);
    SymlinkedChain(scratch);
    LargeJson();
    KeyFileModes(scratch);
    KeyStorePolicy();
    if (argc > 4) CrossFormat(argv[3], argv[4]);
  } else {
    std::printf("usage: sync_scenarios <scratch> <sealed fixture> [reference dir] [output dir]\n"
                "       sync_scenarios --secret-service <libsecret>\n");
    return 2;
  }
  if (failures) {
    std::printf("%d sync checks failed\n", failures);
    return 1;
  }
  std::printf("sync scenarios passed\n");
  return 0;
}
