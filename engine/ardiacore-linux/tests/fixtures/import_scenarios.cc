#include <algorithm>
#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <memory>
#include <random>
#include <set>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

#include "ardia/linux/ac_linux_import_crypto.h"
#include "ardia/linux/ac_linux_import_formats.h"
#include "ardia/linux/ac_linux_import_keyring.h"
#include "ardia/linux/ac_linux_import_readers.h"
#include "ardia/linux/ac_linux_import_secrets.h"
#include "base/values.h"

using namespace ardia::linux_import;

namespace {

std::string FixtureSecret(std::string_view prefix) {
  static std::mt19937_64 engine(std::random_device{}());
  std::string secret(prefix);
  for (int i = 0; i < 24; ++i) secret.push_back("0123456789abcdefghijklmnopqrstuvwxyz"[engine() % 36]);
  return secret;
}

std::string Slurp(const char* path) {
  std::ifstream in(path, std::ios::binary);
  std::stringstream buffer;
  buffer << in.rdbuf();
  return buffer.str();
}

base::ListValue Rows(const std::vector<Credential>& credentials) {
  base::ListValue rows;
  for (const Credential& credential : credentials) {
    base::DictValue row;
    row.Set("url", credential.url);
    row.Set("username", credential.username);
    row.Set("password", credential.password);
    if (!credential.realm.empty()) row.Set("realm", credential.realm);
    if (!credential.title.empty()) row.Set("title", credential.title);
    if (!credential.note.empty()) row.Set("note", credential.note);
    if (credential.created > 0) row.Set("created", credential.created);
    if (credential.last_used > 0) row.Set("lastUsed", credential.last_used);
    if (credential.times_used > 0) row.Set("timesUsed", credential.times_used);
    rows.Append(std::move(row));
  }
  return rows;
}

std::string Hex(std::string_view bytes) {
  std::string out;
  char buffer[3];
  for (const char c : bytes) {
    std::snprintf(buffer, sizeof(buffer), "%02x", static_cast<unsigned char>(c));
    out += buffer;
  }
  return out;
}

std::string Unhex(std::string_view hex) {
  std::string out;
  for (size_t i = 0; i + 1 < hex.size(); i += 2) out.push_back(static_cast<char>(std::stoi(std::string(hex.substr(i, 2)), nullptr, 16)));
  return out;
}

base::ListValue CookieRows(const std::vector<ImportedCookie>& cookies) {
  base::ListValue rows;
  for (const ImportedCookie& cookie : cookies) {
    base::DictValue row;
    row.Set("domain", cookie.domain);
    row.Set("name", cookie.name);
    row.Set("value", cookie.value.value());
    row.Set("path", cookie.path);
    row.Set("created", cookie.created);
    row.Set("expires", cookie.expires);
    row.Set("lastAccess", cookie.last_access);
    row.Set("secure", cookie.secure);
    row.Set("httpOnly", cookie.http_only);
    row.Set("sameSite", cookie.same_site);
    row.Set("priority", cookie.priority);
    row.Set("partition", cookie.partitioned ? cookie.partition_site : std::string());
    row.Set("crossSite", cookie.partition_cross_site);
    row.Set("sourceScheme", cookie.source_scheme);
    row.Set("sourcePort", cookie.source_port);
    rows.Append(std::move(row));
  }
  return rows;
}

base::ListValue AddressRows(const std::vector<ImportedAddress>& addresses) {
  base::ListValue rows;
  for (const ImportedAddress& a : addresses) {
    base::DictValue row;
    row.Set("name", a.name);
    row.Set("organization", a.organization);
    row.Set("street", a.street);
    row.Set("city", a.city);
    row.Set("state", a.state);
    row.Set("postalCode", a.postal_code);
    row.Set("country", a.country);
    row.Set("phone", a.phone);
    row.Set("email", a.email);
    rows.Append(std::move(row));
  }
  return rows;
}

base::ListValue CardRows(const std::vector<ImportedCard>& cards) {
  base::ListValue rows;
  for (const ImportedCard& card : cards) {
    base::DictValue row;
    row.Set("name", card.name);
    row.Set("number", card.number.value());
    row.Set("expMonth", card.exp_month);
    row.Set("expYear", card.exp_year);
    row.Set("nickname", card.nickname);
    rows.Append(std::move(row));
  }
  return rows;
}

std::string_view StatusName(KeyringStatus status) {
  switch (status) {
    case KeyringStatus::kOk:
      return "ok";
    case KeyringStatus::kMissing:
      return "missing";
    case KeyringStatus::kLocked:
      return "locked";
    case KeyringStatus::kDenied:
      return "denied";
    case KeyringStatus::kUnavailable:
      return "unavailable";
  }
  return "unavailable";
}

void SecretUnits() {
  const std::string token = "0000000000000000000000000000000a";
  ImportedVault vault;
  ImportedData data;
  data.cookies.emplace_back();
  data.cookies.back().value = SecretBytes("cookie-secret-value");
  data.cards.emplace_back();
  data.cards.back().number = SecretBytes("4111 1111 1111 1111");
  assert(!vault.Put("w1", "bad", ImportedData{}, 0));
  assert(vault.Put("w1", token, std::move(data), 0));
  assert(!vault.Put("w2", token, ImportedData{}, 0));
  assert(!vault.Take("w2", token, 1));
  std::optional<ImportedData> taken = vault.Take("w1", token, 1);
  assert(taken && taken->cookies.size() == 1 && taken->cookies[0].value.value() == "cookie-secret-value");
  assert(!vault.Take("w1", token, 2));
  base::DictValue clean;
  clean.Set("cookieCount", 1);
  clean.Set("name", "nothing secret");
  assert(!ReplyLeaksImported(base::Value(std::move(clean)), taken->cookies, taken->cards));
  base::DictValue cookie;
  cookie.Set("note", "has cookie-secret-value inside");
  assert(!ReplyLeaksImported(base::Value(std::move(cookie)), taken->cookies, taken->cards));
  base::DictValue whole;
  whole.Set("title", "cookie-secret-value");
  assert(ReplyLeaksImported(base::Value(std::move(whole)), taken->cookies, taken->cards));
  std::vector<ImportedCookie> common(1);
  common[0].value = SecretBytes("en-US");
  base::DictValue ordinary;
  ordinary.Set("url", "https://example.com/en-US/page");
  ordinary.Set("title", "en-US");
  assert(!ReplyLeaksImported(base::Value(std::move(ordinary)), common, taken->cards));
  base::DictValue card;
  card.Set("note", "4111-1111-1111-1111");
  assert(ReplyLeaksImported(base::Value(std::move(card)), taken->cookies, taken->cards));
  base::DictValue embedded;
  embedded.Set("url", "https://shop.example/?order=4111111111111111x");
  assert(!ReplyLeaksImported(base::Value(std::move(embedded)), taken->cookies, taken->cards));
  assert(vault.Put("w1", token, ImportedData{}, 0));
  assert(!vault.Take("w1", token, kVaultLifetimeMs));
  for (int i = 0; i < 10; ++i) {
    char buffer[33];
    std::snprintf(buffer, sizeof(buffer), "%032x", i + 100);
    assert(vault.Put("w1", buffer, ImportedData{}, 5));
  }
  assert(vault.size() == kVaultEntriesPerOwner);
  vault.DiscardOwner("w1");
  assert(vault.size() == 0);

  UnlockedKeys keys;
  keys.Set("w1", "chrome", SecretBytes("key-one"), 0);
  keys.Set("w1", "chrome", SecretBytes("key-two"), 1);
  keys.Set("w2", "chrome", SecretBytes("other"), 1);
  assert(keys.size() == 2);
  assert(keys.Copy("w1", "chrome", 2)->value() == "key-two");
  assert(!keys.Copy("w1", "brave", 2));
  assert(!keys.Copy("w1", "chrome", kVaultLifetimeMs + 2));
  keys.Forget("w1");
  assert(!keys.Copy("w1", "chrome", 3) && keys.Copy("w2", "chrome", 3));
  keys.Expire(kVaultLifetimeMs + 5);
  assert(keys.size() == 0);

  SecretBytes moved("abc");
  SecretBytes target(std::move(moved));
  assert(moved.empty() && target.value() == "abc");
  std::string digits;
  assert(CardDigits("4111-1111 1111 1111", &digits) && digits == "4111111111111111");
  assert(!CardDigits("4111x", &digits) && digits.empty());
  assert(!CardDigits("123", &digits));
  std::string site;
  bool cross = true;
  assert(FirefoxPartitionSite("(https,Example.com)", &site, &cross) && site == "https://example.com" && !cross);
  assert(FirefoxPartitionSite("(http,a.example,8080)", &site, &cross) && site == "http://a.example" && !cross);
  assert(FirefoxPartitionSite("(https,example.com,f)", &site, &cross) && site == "https://example.com" && cross);
  assert(FirefoxPartitionSite("(https,example.com,8443,f)", &site, &cross) && site == "https://example.com" && cross);
  assert(!FirefoxPartitionSite("(ftp,a.example)", &site, &cross) && !FirefoxPartitionSite("(https,a b)", &site, &cross) &&
         !FirefoxPartitionSite("(https,a.example,0)", &site, &cross) && !FirefoxPartitionSite("https,a", &site, &cross) &&
         !FirefoxPartitionSite("(https,a.example,8443,x)", &site, &cross) &&
         !FirefoxPartitionSite("(https,a.example,f,f)", &site, &cross));
  std::string json;
  AppendJsonString("a\"b\\c\n\x01", &json);
  assert(json == "\"a\\\"b\\\\c\\u000a\\u0001\"");
  std::optional<SafeStorageItem> chrome = SafeStorageFor("chromeBeta");
  assert(chrome && chrome->application == "chrome" && chrome->kwallet_folder == "Chrome Keys" &&
         chrome->kwallet_key == "Chrome Safe Storage");
  assert(SafeStorageFor("chromiumSnap")->application == "chromium");
  assert(SafeStorageFor("braveFlatpak")->kwallet_key == "Brave Safe Storage");
  assert(SafeStorageFor("edgeDev")->application == "microsoft-edge");
  assert(!SafeStorageFor("firefox"));
  std::printf("secret units passed\n");
}

void ReviewUnits() {
  static_assert(kPasswordChunk > 0 && kPasswordChunk <= 3000);
  std::vector<Credential> chunk(3);
  chunk[0].url = "https://a.example/login";
  chunk[0].username = "u";
  chunk[0].password = "p1";
  chunk[1].url = "https://A.example/other";
  chunk[1].username = "u";
  chunk[1].password = "p2";
  chunk[2].url = "https://b.example/";
  chunk[2].username = "v";
  chunk[2].password = "p3";
  std::set<std::string> existing = {ExistingKey("https://a.example/", "u", "p1"), ExistingKey("https://b.example/x", "v", "other")};
  assert(ExistingKey("https://a.example/login", "u", "p1") == ExistingKey("https://A.EXAMPLE/", "u", "p1"));
  assert(CountExisting(chunk, existing) == 1);

  PasswordTally tally;
  tally.AddChunk(3, 1, 2, 1);
  tally.AddChunk(2, 5, 0, 0);
  assert(tally.added == 2 && tally.existing == 3 && tally.conflicts == 2 && tally.invalid == 1);
  base::DictValue counts = tally.ToValue();
  assert(counts.FindInt("added") == 2 && counts.FindInt("existing") == 3 && counts.FindInt("conflicts") == 2 &&
         counts.FindInt("invalid") == 1);

  base::ListValue summaries = CredentialSummaries(chunk);
  assert(summaries.size() == 3);
  assert(base::ToJson(summaries).find("p1") == std::string::npos);
  assert(*summaries[0].GetDict().FindString("username") == "u");
  const std::string leaked = FixtureSecret("two-");
  std::vector<Credential> secrets(1);
  secrets[0].password = leaked;
  assert(!ReplyLeaksSecret(base::Value(std::move(summaries)), secrets));
  base::DictValue exact;
  base::ListValue nested;
  nested.Append(leaked);
  exact.Set("rows", std::move(nested));
  assert(ReplyLeaksSecret(base::Value(std::move(exact)), secrets));
  base::DictValue substring;
  substring.Set("title", "contains " + leaked + " inside a history title");
  assert(!ReplyLeaksSecret(base::Value(std::move(substring)), secrets));
  base::DictValue field;
  base::DictValue inner;
  inner.Set("password", "x");
  field.Set("entry", std::move(inner));
  assert(ReplyLeaksSecret(base::Value(std::move(field)), {}));
  base::DictValue rows;
  base::ListValue listed;
  listed.Append(base::DictValue());
  rows.Set("credentials", std::move(listed));
  assert(ReplyLeaksSecret(base::Value(std::move(rows)), {}));
  base::DictValue empty_rows;
  empty_rows.Set("credentials", base::ListValue());
  empty_rows.Set("password", "");
  assert(!ReplyLeaksSecret(base::Value(std::move(empty_rows)), {}));

  std::string password;
  assert(DecryptChromiumPassword("v12whatever", &password) == Decrypted::kKeyring && password.empty());
  assert(kChromiumEmptyKey[0] == 0xd0 && kChromiumEmptyKey[15] == 0x7f);

  CredentialVault vault;
  assert(vault.Put("w1", "0000000000000000000000000000000a", {}, 5));
  assert(vault.Put("w1", "0000000000000000000000000000000b", {}, 9));
  assert(vault.NextExpiry() == 5 + kVaultLifetimeMs);
  vault.Expire(5 + kVaultLifetimeMs);
  assert(vault.NextExpiry() == 9 + kVaultLifetimeMs);
  vault.Clear();
  assert(!vault.NextExpiry());

  BookmarksParse lt = ParseNetscapeBookmarks("<DL><p><DT><A HREF=\"https://lt.example/\">a < b &lt; c</A></DL>");
  assert(lt.root && *lt.root->FindList("children")->begin()->GetDict().FindString("title") == "a < b < c");
  std::printf("review units passed\n");
}

class Recorder : public ImportObserver {
 public:
  explicit Recorder(int cancel_at_history) : cancel_at_history_(cancel_at_history) {}
  bool Cancelled() const override { return cancelled_; }
  void Progress(std::string_view kind, std::string_view phase, int processed, std::optional<int> total) override {
    base::DictValue event;
    event.Set("kind", kind);
    event.Set("phase", phase);
    event.Set("processed", processed);
    if (total) event.Set("total", *total);
    events_.Append(std::move(event));
    if (cancel_at_history_ > 0 && kind == "history" && processed >= cancel_at_history_) cancelled_ = true;
  }
  base::ListValue Take() { return std::move(events_); }

 private:
  int cancel_at_history_;
  bool cancelled_ = false;
  base::ListValue events_;
};

std::vector<std::string> Split(const std::string& text) {
  std::vector<std::string> parts;
  std::string part;
  for (char c : text) {
    if (c == ',') {
      parts.push_back(part);
      part.clear();
    } else {
      part.push_back(c);
    }
  }
  if (!part.empty()) parts.push_back(part);
  return parts;
}

void Units() {
  assert(ClassifyProfile("") == ProfileTarget::kDefault);
  assert(ClassifyProfile("default") == ProfileTarget::kDefault);
  assert(ClassifyProfile("incognito:w1@") == ProfileTarget::kPrivate);
  assert(ClassifyProfile("work") == ProfileTarget::kIsolated);
  assert(ClassifyProfile("DEFAULT") == ProfileTarget::kInvalid);
  assert(ClassifyProfile("../x") == ProfileTarget::kInvalid);
  assert(ClassifyProfile("1abc") == ProfileTarget::kInvalid);
  assert(ProfileErrorCode(ProfileTarget::kPrivate) == "ERR_PROFILE_PRIVATE");
  assert(ProfileErrorCode(ProfileTarget::kIsolated) == "ERR_PROFILE_UNAVAILABLE");
  assert(ProfileErrorCode(ProfileTarget::kDefault).empty());

  assert(ValidProfileId("Default") && ValidProfileId("Profile 1") && ValidProfileId(".") &&
         ValidProfileId("abcd.default-release") && ValidProfileId("_side_profiles/x"));
  assert(!ValidProfileId("") && !ValidProfileId("..") && !ValidProfileId("a/../b") && !ValidProfileId("/etc") &&
         !ValidProfileId("a//b") && !ValidProfileId("a/") && !ValidProfileId(std::string("a\nb")));
  assert(ValidJobId("import-1") && !ValidJobId("") && !ValidJobId("a b") && !ValidJobId(std::string(65, 'a')));
  assert(ValidBrowserId("chromeFlatpak") && !ValidBrowserId("chrome/../x") && !ValidBrowserId(""));
  assert(ValidToken("0123456789abcdef0123456789abcdef") && !ValidToken("0123456789ABCDEF0123456789abcdef") &&
         !ValidToken("short"));
  assert(ValidChooserKind("bookmarksHTML") && ValidChooserKind("passwordsCSV") && !ValidChooserKind("safariExport"));
  assert(ValidLocalFile("/tmp/x.html") && !ValidLocalFile("relative") && !ValidLocalFile(std::string("/a\0b", 4)));

  base::ListValue kinds;
  kinds.Append("passwords");
  kinds.Append("bogus");
  kinds.Append("bookmarks");
  kinds.Append("passwords");
  kinds.Append(3);
  const std::vector<std::string> requested = RequestedKinds(&kinds);
  assert((requested == std::vector<std::string>{"passwords", "bookmarks"}));
  assert(RequestedKinds(nullptr).empty());

  assert(OriginOf("https://User:pw@Example.COM:8443/path?q") == "https://example.com:8443");
  assert(OriginOf("example.com/login") == "https://example.com");
  assert(OriginOf("javascript:alert(1)").empty());
  assert(OriginOf("mailto:a@example.com").empty());
  assert(OriginOf("example.com:8080/x") == "https://example.com:8080");
  assert(OriginOf("ftp://example.com").empty());
  assert(OriginOf("https://").empty());
  assert(OriginOf("android://hash@com.example.app/") == "android://hash@com.example.app");

  ChosenFiles chosen;
  chosen.Remember("w1", "bookmarksHTML", "/tmp/a.html", 1000);
  assert(!chosen.Take("w2", "bookmarksHTML", "/tmp/a.html", 1001));
  assert(!chosen.Take("w1", "passwordsCSV", "/tmp/a.html", 1001));
  assert(chosen.Take("w1", "bookmarksHTML", "/tmp/a.html", 1002));
  assert(!chosen.Take("w1", "bookmarksHTML", "/tmp/a.html", 1003));
  chosen.Remember("w1", "passwordsCSV", "/tmp/p.csv", 0);
  assert(!chosen.Take("w1", "passwordsCSV", "/tmp/p.csv", kChosenFileLifetimeMs));
  for (int i = 0; i < 40; ++i) chosen.Remember("w1", "bookmarksHTML", "/tmp/" + std::to_string(i), 5);
  assert(chosen.size() == kChosenFiles);
  assert(!chosen.Take("w1", "bookmarksHTML", "/tmp/0", 6));
  assert(chosen.Take("w1", "bookmarksHTML", "/tmp/39", 6));
  chosen.Forget("w1");
  assert(chosen.size() == 0);

  CredentialVault vault;
  const std::string token = "00000000000000000000000000000001";
  std::vector<Credential> stored;
  stored.emplace_back();
  stored.back().url = "https://a.example";
  const std::string stored_password = FixtureSecret("stored-");
  stored.back().password = stored_password;
  assert(!vault.Put("w1", "BAD", {}, 0));
  assert(vault.Put("w1", token, std::move(stored), 0));
  assert(!vault.Put("w1", token, {}, 0));
  assert(vault.Contains("w1", token, 1) && !vault.Contains("w2", token, 1) &&
         !vault.Contains("w1", "00000000000000000000000000000002", 1));
  assert(!vault.Take("w2", token, 1));
  std::optional<std::vector<Credential>> taken = vault.Take("w1", token, 1);
  assert(taken && taken->size() == 1 && (*taken)[0].password == stored_password);
  assert(!vault.Take("w1", token, 2));
  assert(vault.Put("w1", token, {}, 0));
  assert(!vault.Contains("w1", token, kVaultLifetimeMs));
  assert(!vault.Take("w1", token, kVaultLifetimeMs));
  for (int i = 0; i < 12; ++i) {
    char buffer[33];
    std::snprintf(buffer, sizeof(buffer), "%032x", i + 16);
    assert(vault.Put("w1", buffer, {}, 10));
  }
  assert(vault.size() == kVaultEntriesPerOwner);
  assert(vault.Put("w2", "0000000000000000000000000000abcd", {}, 10));
  vault.DiscardOwner("w1");
  assert(vault.size() == 1);
  assert(vault.Discard("w2", "0000000000000000000000000000abcd"));
  assert(vault.size() == 0);

  Credential moved;
  const std::string moved_password = FixtureSecret("moved-");
  moved.password = moved_password;
  Credential target(std::move(moved));
  assert(target.password == moved_password && moved.password.empty());
  std::string secret = FixtureSecret("wipe-");
  Wipe(secret);
  assert(secret.empty());

  assert(ValidUtf8("plain") && ValidUtf8("caf\xC3\xA9") && !ValidUtf8("\xC3") && !ValidUtf8("\xED\xA0\x80") &&
         !ValidUtf8("\xC0\x80"));
  assert(DecodeText("\xEF\xBB\xBFok") == "ok");
  assert(DecodeText("caf\xE9") == "caf\xC3\xA9");
  int64_t parsed = 0;
  assert(ParseInt64(" 42 ", &parsed) && parsed == 42 && !ParseInt64("4x", &parsed) && !ParseInt64("", &parsed));

  std::string password;
  assert(DecryptChromiumPassword("v11whatever", &password) == Decrypted::kKeyring && password.empty());
  assert(DecryptChromiumPassword("v10short", &password) == Decrypted::kFailed);
  assert(DecryptChromiumPassword("legacy-plain", &password) == Decrypted::kOk && password == "legacy-plain");
  assert(DecryptChromiumPassword("", &password) == Decrypted::kFailed);
  std::printf("units passed\n");
}

}

int main(int argc, char** argv) {
  if (argc < 2) return 2;
  const std::string command = argv[1];
  if (command == "units") {
    Units();
    return 0;
  }
  if (command == "review") {
    ReviewUnits();
    return 0;
  }
  if (command == "readfile") {
    std::string contents;
    std::printf("%d\n", static_cast<int>(ReadFileLimited(argv[2], 1024, &contents)));
    return 0;
  }
  if (command == "key") {
    for (unsigned char byte : kChromiumBasicKey) std::printf("%02x", byte);
    std::printf("\n");
    return 0;
  }
  if (command == "html") {
    BookmarksParse parse = ParseNetscapeBookmarks(Slurp(argv[2]));
    base::DictValue out;
    out.Set("links", parse.links);
    out.Set("folders", parse.folders);
    out.Set("truncated", parse.truncated);
    out.Set("error", parse.error_code);
    if (parse.root) {
      out.Set("counted", CountBookmarkLinks(*parse.root));
      out.Set("root", std::move(*parse.root));
    }
    std::cout << base::ToJson(out) << "\n";
    return 0;
  }
  if (command == "csv") {
    CsvParse parse = ParsePasswordsCsv(Slurp(argv[2]));
    base::DictValue out;
    out.Set("rows", parse.rows);
    out.Set("duplicates", parse.duplicates);
    out.Set("invalid", parse.invalid);
    out.Set("error", parse.error_code);
    out.Set("credentials", Rows(parse.credentials));
    std::cout << base::ToJson(out) << "\n";
    return 0;
  }
  if (command == "ini") {
    base::ListValue out;
    for (const FirefoxProfileEntry& entry : ParseProfilesIni(Slurp(argv[2]))) {
      base::DictValue item;
      item.Set("name", entry.name);
      item.Set("path", entry.path);
      item.Set("relative", entry.relative);
      item.Set("default", entry.is_default);
      out.Append(std::move(item));
    }
    std::cout << base::ToJson(out) << "\n";
    return 0;
  }
  if (command == "sweep") {
    std::printf("%d\n", RemoveStaleScratch(argv[2], std::atoll(argv[3]), std::atoll(argv[4])));
    return 0;
  }
  if (command == "secrets") {
    SecretUnits();
    return 0;
  }
  if (command == "derive" && argc > 2) {
    std::cout << Hex(DeriveChromiumKey(argv[2]).value()) << "\n";
    return 0;
  }
  if (command == "mozlz4" && argc > 2) {
    std::string out;
    const bool ok = DecompressMozLz4(Slurp(argv[2]), &out);
    std::cout << (ok ? "ok " + Hex(out) : std::string("failed")) << "\n";
    return 0;
  }
  if (command == "firefoxfield" && argc > 3) {
    FirefoxKeys key;
    key.Add(std::string("\xf8\0\0\0\0\0\0\0\0\0\0\0\0\0\0\x01", 16), SecretBytes(Unhex(argv[3])), true);
    std::string plain;
    std::cout << (DecryptFirefoxField(argv[2], key, &plain) ? "ok " + plain : std::string("failed")) << "\n";
    return 0;
  }
  if (command == "keyring" && argc > 3) {
    std::optional<SafeStorageItem> item = SafeStorageFor(argv[2]);
    if (!item) return 3;
    std::unique_ptr<Keyring> keyring = SystemKeyring();
    const int timeout = argc > 4 ? std::atoi(argv[4]) : kKeyringProbeTimeoutMs;
    base::DictValue out;
    if (std::string(argv[3]) == "exists") {
      out.Set("status", StatusName(keyring->Exists(*item, timeout)));
    } else {
      KeyringLookup lookup = keyring->Read(*item, timeout);
      out.Set("status", StatusName(lookup.status));
      out.Set("backend", lookup.backend);
      out.Set("secret", lookup.secret.value());
      out.Set("key", lookup.secret.empty() ? std::string() : Hex(DeriveChromiumKey(lookup.secret.value()).value()));
      out.Set("code", KeyringErrorCode(lookup.status));
    }
    out.Set("application", item->application);
    out.Set("folder", item->kwallet_folder);
    out.Set("entry", item->kwallet_key);
    std::cout << base::ToJson(out) << "\n";
    return 0;
  }
  if (argc < 6) return 2;
  const Environment environment = MakeEnvironment(argv[2], argv[3], argv[4], argv[5]);
  if (command == "discover") {
    std::cout << base::ToJson(ListBrowsers(environment)) << "\n";
    return 0;
  }
  if (command == "discover-keyring") {
    std::unique_ptr<Keyring> keyring = SystemKeyring();
    std::cout << base::ToJson(ListBrowsers(environment, keyring.get())) << "\n";
    return 0;
  }
  if (command == "firefox-unlock" && argc > 9) {
    std::unique_ptr<Keyring> keyring = argc > 10 && std::string(argv[10]) == "keyring" ? SystemKeyring() : nullptr;
    const auto list = [](const char* text) { return std::string(text) == "-" ? std::vector<std::string>() : Split(text); };
    FirefoxUnlock unlock = UnlockFirefox(environment, argv[6], SecretBytes(std::string(argv[7]) == "-" ? "" : argv[7]),
                                         list(argv[8]), list(argv[9]), keyring.get(), 5000);
    base::DictValue out;
    out.Set("code", unlock.code);
    out.Set("message", unlock.message);
    out.Set("primary", unlock.primary_password ? unlock.primary_password->value() : std::string());
    out.Set("cardKey", unlock.card_key ? Hex(unlock.card_key->value()) : std::string());
    out.Set("cardsLocked", unlock.cards_locked);
    std::cout << base::ToJson(out) << "\n";
    return 0;
  }
  if (command == "extensions") {
    std::cout << base::ToJson(ListExtensions(environment, argv[6], argv[7])) << "\n";
    return 0;
  }
  if (command == "read") {
    ImportOptions options;
    if (argc > 9 && std::atoi(argv[9]) > 0) options.history_limit = std::atoi(argv[9]);
    if (argc > 10 && std::atof(argv[10]) > 0) options.history_since = std::atof(argv[10]);
    Recorder recorder(argc > 11 ? std::atoi(argv[11]) : 0);
    if (argc > 12 && std::string(argv[12]) != "-") options.chromium_key = SecretBytes(Unhex(argv[12]));
    if (argc > 13 && std::string(argv[13]) != "-") options.firefox_primary_password = SecretBytes(argv[13]);
    options.now_ms = argc > 14 ? std::atof(argv[14]) : 1700000000000.0;
    if (argc > 15 && std::string(argv[15]) != "-") options.firefox_card_key = SecretBytes(Unhex(argv[15]));
    ImportOutcome outcome = ReadBrowserProfile(environment, argv[6], argv[7], Split(argv[8]), options, recorder);
    base::DictValue out;
    out.Set("cancelled", outcome.cancelled);
    out.Set("error", outcome.error_code);
    out.Set("result", std::move(outcome.result));
    out.Set("credentials", Rows(outcome.credentials));
    out.Set("withheld", OutcomeLeaks(outcome));
    out.Set("cookies", CookieRows(outcome.cookies));
    out.Set("addresses", AddressRows(outcome.addresses));
    out.Set("cards", CardRows(outcome.cards));
    int dropped = 0;
    out.Set("cookiesPayload", CookiesPayload(outcome.cookies, 0, outcome.cookies.size(), &dropped).value());
    out.Set("cookiesDropped", dropped);
    out.Set("autofillPayload", AutofillPayload(outcome.addresses, outcome.cards, 0,
                                               std::max(outcome.addresses.size(), outcome.cards.size())).value());
    out.Set("progress", recorder.Take());
    std::cout << base::ToJson(out) << "\n";
    return 0;
  }
  return 2;
}
