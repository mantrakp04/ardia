#include "ardia/linux/ac_linux_import_formats.h"

#include <algorithm>
#include <charconv>
#include <cstdint>
#include <initializer_list>
#include <iterator>
#include <set>
#include <utility>

namespace ardia::linux_import {
namespace {

constexpr const char* kKinds[] = {"bookmarks", "history", "tabs", "passwords", "cookies",
                                  "autofill", "spaces", "pinnedTabs", "favorites"};

bool IsSpace(char c) {
  return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v';
}

bool IsAlnum(char c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
}

char Lower(char c) {
  return c >= 'A' && c <= 'Z' ? static_cast<char>(c - 'A' + 'a') : c;
}

std::string LowerAscii(std::string_view text) {
  std::string out(text);
  for (char& c : out) c = Lower(c);
  return out;
}

std::string_view Trim(std::string_view text) {
  while (!text.empty() && IsSpace(text.front())) text.remove_prefix(1);
  while (!text.empty() && IsSpace(text.back())) text.remove_suffix(1);
  return text;
}

void AppendUtf8(std::string& out, uint32_t code) {
  if (code < 0x80) {
    out.push_back(static_cast<char>(code));
  } else if (code < 0x800) {
    out.push_back(static_cast<char>(0xC0 | (code >> 6)));
    out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
  } else if (code < 0x10000) {
    out.push_back(static_cast<char>(0xE0 | (code >> 12)));
    out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
  } else {
    out.push_back(static_cast<char>(0xF0 | (code >> 18)));
    out.push_back(static_cast<char>(0x80 | ((code >> 12) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
  }
}

bool ParseCodePoint(std::string_view digits, int base, uint32_t* code) {
  if (digits.empty() || digits.size() > 8) return false;
  uint32_t value = 0;
  const auto [end, error] = std::from_chars(digits.data(), digits.data() + digits.size(), value, base);
  if (error != std::errc() || end != digits.data() + digits.size()) return false;
  if (value == 0 || value > 0x10FFFF || (value >= 0xD800 && value <= 0xDFFF)) return false;
  *code = value;
  return true;
}

std::string DecodeEntities(std::string_view text) {
  if (text.find('&') == std::string_view::npos) return std::string(text);
  std::string out;
  out.reserve(text.size());
  size_t i = 0;
  while (i < text.size()) {
    if (text[i] == '&') {
      const size_t semi = text.find(';', i + 1);
      if (semi != std::string_view::npos && semi - i <= 12) {
        const std::string_view name = text.substr(i + 1, semi - i - 1);
        std::string replacement;
        uint32_t code = 0;
        if (name == "amp") replacement = "&";
        else if (name == "lt") replacement = "<";
        else if (name == "gt") replacement = ">";
        else if (name == "quot") replacement = "\"";
        else if (name == "apos") replacement = "'";
        else if (name == "nbsp") AppendUtf8(replacement, 0xA0);
        else if (name.size() > 2 && name[0] == '#' && (name[1] == 'x' || name[1] == 'X') &&
                 ParseCodePoint(name.substr(2), 16, &code)) AppendUtf8(replacement, code);
        else if (name.size() > 1 && name[0] == '#' && ParseCodePoint(name.substr(1), 10, &code))
          AppendUtf8(replacement, code);
        if (!replacement.empty()) {
          out += replacement;
          i = semi + 1;
          continue;
        }
      }
    }
    out.push_back(text[i]);
    ++i;
  }
  return out;
}

bool StartsMarkup(std::string_view rest) {
  if (rest.empty()) return false;
  const char c = rest[0];
  return c == '/' || c == '!' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

struct Tag {
  bool closing = false;
  std::string name;
  std::vector<std::pair<std::string, std::string>> attributes;

  std::string Attribute(std::string_view key) const {
    for (const auto& [attribute, value] : attributes) {
      if (attribute == key) return value;
    }
    return {};
  }
};

class TagScanner {
 public:
  explicit TagScanner(std::string_view text) : s_(text) {}

  std::optional<Tag> Next() {
    while (i_ < s_.size()) {
      if (s_[i_] != '<') {
        ++i_;
        continue;
      }
      if (s_.substr(i_, 4) == "<!--") {
        const size_t end = s_.find("-->", i_ + 4);
        i_ = end == std::string_view::npos ? s_.size() : end + 3;
        continue;
      }
      ++i_;
      Tag tag;
      if (i_ < s_.size() && s_[i_] == '/') {
        tag.closing = true;
        ++i_;
      }
      while (i_ < s_.size() && IsAlnum(s_[i_])) tag.name.push_back(Lower(s_[i_++]));
      if (tag.name.empty()) continue;
      while (i_ < s_.size() && s_[i_] != '>') {
        if (IsSpace(s_[i_]) || s_[i_] == '/') {
          ++i_;
          continue;
        }
        std::string key;
        while (i_ < s_.size() && !IsSpace(s_[i_]) && s_[i_] != '=' && s_[i_] != '>') key.push_back(Lower(s_[i_++]));
        std::string value;
        if (i_ < s_.size() && s_[i_] == '=') {
          ++i_;
          if (i_ < s_.size() && (s_[i_] == '"' || s_[i_] == '\'')) {
            const char quote = s_[i_++];
            while (i_ < s_.size() && s_[i_] != quote) value.push_back(s_[i_++]);
            if (i_ < s_.size()) ++i_;
          } else {
            while (i_ < s_.size() && !IsSpace(s_[i_]) && s_[i_] != '>') value.push_back(s_[i_++]);
          }
        }
        if (!key.empty()) tag.attributes.emplace_back(std::move(key), std::move(value));
      }
      if (i_ < s_.size()) ++i_;
      return tag;
    }
    return std::nullopt;
  }

  std::string Text(std::string_view until) {
    std::string out;
    while (i_ < s_.size()) {
      if (s_[i_] == '<' && !StartsMarkup(s_.substr(i_ + 1))) {
        out.push_back(s_[i_++]);
        continue;
      }
      if (s_[i_] == '<') {
        const size_t start = i_;
        std::optional<Tag> tag = Next();
        if (!tag) return out;
        if (tag->closing && tag->name == until) return out;
        if (!tag->closing && (tag->name == "dt" || tag->name == "dl" || tag->name == "h3" || tag->name == "a")) {
          i_ = start;
          return out;
        }
        continue;
      }
      out.push_back(s_[i_++]);
    }
    return out;
  }

 private:
  std::string_view s_;
  size_t i_ = 0;
};

struct Node {
  bool folder = true;
  std::string title;
  std::string url;
  std::string role;
  double added = 0;
  std::vector<Node> children;
};

double SecondsToMs(std::string_view text) {
  int64_t seconds = 0;
  if (!ParseInt64(text, &seconds) || seconds <= 0) return 0;
  return static_cast<double>(seconds) * 1000;
}

base::DictValue NodeValue(Node& node) {
  base::DictValue value;
  value.Set("type", node.folder ? "folder" : "url");
  value.Set("title", std::move(node.title));
  if (node.added > 0) value.Set("dateAdded", node.added);
  if (!node.role.empty()) value.Set("role", std::move(node.role));
  if (node.folder) {
    base::ListValue children;
    for (Node& child : node.children) children.Append(NodeValue(child));
    value.Set("children", std::move(children));
  } else {
    value.Set("url", std::move(node.url));
  }
  return value;
}

bool HasScheme(std::string_view url) {
  const size_t colon = url.find(':');
  if (colon == std::string_view::npos || colon == 0) return false;
  for (size_t i = 0; i < colon; ++i) {
    const char c = url[i];
    if (!IsAlnum(c) && c != '+' && c != '-' && c != '.') return false;
  }
  return url.substr(colon, 3) == "://";
}

std::string FirstUri(std::string_view field) {
  const size_t cut = field.find_first_of(",\n");
  return std::string(Trim(cut == std::string_view::npos ? field : field.substr(0, cut)));
}

}

void Wipe(std::string& secret) {
  volatile char* bytes = secret.data();
  for (size_t i = 0; i < secret.size(); ++i) bytes[i] = 0;
  secret.clear();
  secret.shrink_to_fit();
}

Credential::Credential() = default;

Credential::Credential(Credential&& other)
    : url(std::move(other.url)),
      username(std::move(other.username)),
      password(std::move(other.password)),
      realm(std::move(other.realm)),
      title(std::move(other.title)),
      note(std::move(other.note)),
      created(other.created),
      last_used(other.last_used),
      times_used(other.times_used) {
  Wipe(other.password);
  Wipe(other.note);
}

Credential& Credential::operator=(Credential&& other) {
  if (this == &other) return *this;
  Wipe(password);
  Wipe(note);
  url = std::move(other.url);
  username = std::move(other.username);
  password = std::move(other.password);
  realm = std::move(other.realm);
  title = std::move(other.title);
  note = std::move(other.note);
  created = other.created;
  last_used = other.last_used;
  times_used = other.times_used;
  Wipe(other.password);
  Wipe(other.note);
  return *this;
}

Credential::~Credential() {
  Wipe(password);
  Wipe(note);
}

bool ParseInt64(std::string_view text, int64_t* value) {
  text = Trim(text);
  if (text.empty()) return false;
  const auto [end, error] = std::from_chars(text.data(), text.data() + text.size(), *value);
  return error == std::errc() && end == text.data() + text.size();
}

std::string OriginOf(std::string_view url) {
  url = Trim(url);
  std::string scheme;
  std::string_view rest;
  if (HasScheme(url)) {
    const size_t colon = url.find(':');
    scheme = LowerAscii(url.substr(0, colon));
    rest = url.substr(colon + 3);
  } else {
    const size_t colon = url.find(':');
    if (colon != std::string_view::npos && (colon + 1 >= url.size() || url[colon + 1] < '0' || url[colon + 1] > '9')) {
      return {};
    }
    scheme = "https";
    rest = url;
  }
  if (scheme != "http" && scheme != "https" && scheme != "android") return {};
  const size_t end = rest.find_first_of("/?#");
  std::string_view authority = end == std::string_view::npos ? rest : rest.substr(0, end);
  if (scheme != "android") {
    const size_t at = authority.rfind('@');
    if (at != std::string_view::npos) authority.remove_prefix(at + 1);
  }
  if (authority.empty()) return {};
  for (char c : authority) {
    if (IsSpace(c) || c == '\\' || c == '<' || c == '>' || c == '"' || static_cast<unsigned char>(c) < 0x20) return {};
  }
  return scheme + "://" + (scheme == "android" ? std::string(authority) : LowerAscii(authority));
}

std::string CredentialKey(const Credential& credential, bool compare_passwords) {
  std::string key = credential.realm.empty() ? OriginOf(credential.url) : credential.realm;
  key.push_back('\0');
  key += credential.username;
  if (compare_passwords) {
    key.push_back('\0');
    key += credential.password;
  }
  return key;
}

size_t RemoveDuplicateCredentials(std::vector<Credential>& credentials, bool compare_passwords) {
  std::set<std::string> seen;
  std::vector<Credential> kept;
  kept.reserve(credentials.size());
  size_t removed = 0;
  for (Credential& credential : credentials) {
    std::string key = CredentialKey(credential, compare_passwords);
    const bool fresh = seen.insert(key).second;
    Wipe(key);
    if (fresh) kept.push_back(std::move(credential));
    else ++removed;
  }
  credentials = std::move(kept);
  while (!seen.empty()) {
    auto node = seen.extract(seen.begin());
    Wipe(node.value());
  }
  return removed;
}

bool ValidUtf8(std::string_view text) {
  size_t i = 0;
  while (i < text.size()) {
    const unsigned char c = static_cast<unsigned char>(text[i]);
    size_t length = 0;
    uint32_t code = 0;
    if (c < 0x80) {
      ++i;
      continue;
    } else if ((c & 0xE0) == 0xC0) {
      length = 2;
      code = c & 0x1F;
    } else if ((c & 0xF0) == 0xE0) {
      length = 3;
      code = c & 0x0F;
    } else if ((c & 0xF8) == 0xF0) {
      length = 4;
      code = c & 0x07;
    } else {
      return false;
    }
    if (i + length > text.size()) return false;
    for (size_t k = 1; k < length; ++k) {
      const unsigned char next = static_cast<unsigned char>(text[i + k]);
      if ((next & 0xC0) != 0x80) return false;
      code = (code << 6) | (next & 0x3F);
    }
    if ((length == 2 && code < 0x80) || (length == 3 && code < 0x800) || (length == 4 && code < 0x10000) ||
        code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)) {
      return false;
    }
    i += length;
  }
  return true;
}

std::string Latin1ToUtf8(std::string_view text) {
  std::string out;
  out.reserve(text.size() * 2);
  for (char c : text) AppendUtf8(out, static_cast<unsigned char>(c));
  return out;
}

std::string DecodeText(std::string_view bytes) {
  if (bytes.substr(0, 3) == "\xEF\xBB\xBF") bytes.remove_prefix(3);
  return ValidUtf8(bytes) ? std::string(bytes) : Latin1ToUtf8(bytes);
}

BookmarksParse ParseNetscapeBookmarks(std::string_view bytes) {
  BookmarksParse parse;
  if (bytes.size() > kMaxBookmarksHtmlBytes) {
    parse.error_code = "tooLarge";
    parse.error = "The bookmarks file is too large";
    return parse;
  }
  const std::string html = DecodeText(bytes);
  std::vector<Node> stack(1);
  stack[0].title = "Bookmarks";
  std::optional<Node> pending;
  bool saw_root_list = false;
  int flattened = 0;
  size_t nodes = 0;
  TagScanner scanner(html);

  auto append = [&](Node node) {
    if (nodes >= kMaxBookmarkNodes) {
      parse.truncated = true;
      return;
    }
    ++nodes;
    if (node.folder) ++parse.folders;
    else ++parse.links;
    stack.back().children.push_back(std::move(node));
  };
  auto open_folder = [&](Node node) {
    if (stack.size() > static_cast<size_t>(kMaxBookmarkDepth)) {
      parse.truncated = true;
      ++flattened;
      return;
    }
    stack.push_back(std::move(node));
  };

  while (std::optional<Tag> tag = scanner.Next()) {
    if (!tag->closing && tag->name == "h3") {
      Node folder;
      folder.title = std::string(Trim(DecodeEntities(scanner.Text("h3"))));
      folder.added = SecondsToMs(tag->Attribute("add_date"));
      const std::string id = tag->Attribute("id");
      if (LowerAscii(tag->Attribute("personal_toolbar_folder")) == "true" || id == "com.apple.FavoritesBar") {
        folder.role = "toolbar";
      } else if (LowerAscii(tag->Attribute("unfiled_bookmarks_folder")) == "true") {
        folder.role = "other";
      } else if (id == "com.apple.ReadingList") {
        folder.role = "readingList";
      }
      if (pending) append(std::move(*pending));
      pending = std::move(folder);
    } else if (!tag->closing && tag->name == "dl") {
      if (pending) {
        Node folder = std::move(*pending);
        pending.reset();
        open_folder(std::move(folder));
      } else if (!saw_root_list) {
        saw_root_list = true;
      } else {
        open_folder(Node());
      }
    } else if (tag->closing && tag->name == "dl") {
      if (pending) {
        append(std::move(*pending));
        pending.reset();
      }
      if (flattened > 0) {
        --flattened;
      } else if (stack.size() > 1) {
        Node done = std::move(stack.back());
        stack.pop_back();
        append(std::move(done));
      }
    } else if (!tag->closing && tag->name == "a") {
      const std::string title(Trim(DecodeEntities(scanner.Text("a"))));
      const std::string href(Trim(DecodeEntities(tag->Attribute("href"))));
      if (href.empty() || href.rfind("place:", 0) == 0) continue;
      if (pending) {
        append(std::move(*pending));
        pending.reset();
      }
      Node link;
      link.folder = false;
      link.title = title.empty() ? href : title;
      link.url = href;
      link.added = SecondsToMs(tag->Attribute("add_date"));
      append(std::move(link));
    }
  }
  if (pending) append(std::move(*pending));
  while (stack.size() > 1) {
    Node done = std::move(stack.back());
    stack.pop_back();
    append(std::move(done));
  }
  if (parse.links == 0 && stack[0].children.empty()) {
    parse.error_code = "empty";
    parse.error = "The file has no bookmarks";
    return parse;
  }
  parse.root = NodeValue(stack[0]);
  return parse;
}

int CountBookmarkLinks(const base::DictValue& node) {
  const std::string* type = node.FindString("type");
  if (type && *type == "url") return 1;
  const base::ListValue* children = node.FindList("children");
  if (!children) return 0;
  int links = 0;
  for (const base::Value& child : *children) {
    if (child.is_dict()) links += CountBookmarkLinks(child.GetDict());
  }
  return links;
}

std::vector<std::vector<std::string>> ParseCsvRows(std::string_view text) {
  std::vector<std::vector<std::string>> rows;
  std::vector<std::string> row;
  std::string field;
  bool quoted = false;
  if (text.substr(0, 3) == "\xEF\xBB\xBF") text.remove_prefix(3);
  auto end_row = [&] {
    row.push_back(std::move(field));
    field.clear();
    if (!(row.size() == 1 && row[0].empty())) rows.push_back(std::move(row));
    row.clear();
  };
  size_t i = 0;
  while (i < text.size()) {
    const char c = text[i++];
    if (quoted) {
      if (c == '"') {
        if (i < text.size() && text[i] == '"') {
          field.push_back('"');
          ++i;
        } else {
          quoted = false;
        }
      } else {
        field.push_back(c);
      }
      continue;
    }
    if (c == '"' && field.empty()) {
      quoted = true;
    } else if (c == ',') {
      row.push_back(std::move(field));
      field.clear();
    } else if (c == '\r') {
      if (i < text.size() && text[i] == '\n') ++i;
      end_row();
    } else if (c == '\n') {
      end_row();
    } else {
      field.push_back(c);
    }
  }
  if (!field.empty() || !row.empty()) end_row();
  return rows;
}

CsvParse ParsePasswordsCsv(std::string_view bytes) {
  CsvParse parse;
  if (bytes.size() > kMaxPasswordsCsvBytes) {
    parse.error_code = "tooLarge";
    parse.error = "The passwords file is too large";
    return parse;
  }
  std::string text = DecodeText(bytes);
  std::vector<std::vector<std::string>> rows = ParseCsvRows(text);
  Wipe(text);
  auto wipe_rows = [&rows] {
    for (auto& row : rows) {
      for (std::string& field : row) Wipe(field);
    }
    rows.clear();
  };
  if (rows.empty()) {
    parse.error_code = "empty";
    parse.error = "The file is empty";
    return parse;
  }
  std::vector<std::string> header;
  for (const std::string& name : rows[0]) header.push_back(LowerAscii(Trim(name)));
  auto column = [&header](std::initializer_list<std::string_view> keys) -> std::optional<size_t> {
    for (std::string_view key : keys) {
      for (size_t i = 0; i < header.size(); ++i) {
        if (header[i] == key) return i;
      }
    }
    return std::nullopt;
  };
  const auto url = column({"url", "login_uri", "website", "web site", "origin", "hostname", "login url"});
  const auto pass = column({"password", "login_password", "pass"});
  if (!url || !pass) {
    wipe_rows();
    parse.error_code = "unsupported";
    parse.error = "This CSV doesn't have url and password columns";
    return parse;
  }
  const auto user = column({"username", "login_username", "login", "user", "email", "user name"});
  const auto title = column({"name", "title"});
  const auto note = column({"note", "notes", "extra"});
  const auto realm = column({"httprealm"});
  const auto created = column({"timecreated"});
  const auto last_used = column({"timelastused"});
  const auto type = column({"type"});
  auto field = [](const std::vector<std::string>& row, std::optional<size_t> index) -> std::string_view {
    if (!index || *index >= row.size()) return {};
    return row[*index];
  };
  auto time = [&](const std::vector<std::string>& row, std::optional<size_t> index) {
    int64_t ms = 0;
    return ParseInt64(field(row, index), &ms) && ms > 0 ? static_cast<double>(ms) : 0;
  };
  for (size_t r = 1; r < rows.size(); ++r) {
    const std::vector<std::string>& row = rows[r];
    const std::string kind = LowerAscii(Trim(field(row, type)));
    if (!kind.empty() && kind != "login") continue;
    ++parse.rows;
    const std::string site = FirstUri(field(row, url));
    const std::string_view password = field(row, pass);
    if (site.empty() || password.empty() || OriginOf(site).empty()) {
      ++parse.invalid;
      continue;
    }
    if (parse.credentials.size() >= kMaxCredentials) {
      wipe_rows();
      parse.credentials.clear();
      parse.error_code = "tooLarge";
      parse.error = "The passwords file has too many rows";
      return parse;
    }
    Credential credential;
    credential.url = HasScheme(site) ? site : "https://" + site;
    credential.username = std::string(field(row, user));
    credential.password = std::string(password);
    credential.realm = std::string(Trim(field(row, realm)));
    credential.title = std::string(Trim(field(row, title)));
    credential.note = std::string(field(row, note));
    credential.created = time(row, created);
    credential.last_used = time(row, last_used);
    parse.credentials.push_back(std::move(credential));
  }
  wipe_rows();
  parse.duplicates = static_cast<int>(RemoveDuplicateCredentials(parse.credentials, true));
  return parse;
}

base::ListValue CredentialSummaries(const std::vector<Credential>& credentials) {
  base::ListValue rows;
  for (const Credential& credential : credentials) {
    base::DictValue row;
    row.Set("url", credential.url);
    row.Set("username", credential.username);
    rows.Append(std::move(row));
  }
  return rows;
}

namespace {

constexpr size_t kExactSecretBytes = 6;

bool ValueLeaks(const base::Value& value, const std::set<std::string_view>& secrets) {
  if (value.is_string()) return secrets.contains(value.GetString());
  if (value.is_list()) {
    for (const base::Value& item : value.GetList()) {
      if (ValueLeaks(item, secrets)) return true;
    }
    return false;
  }
  if (!value.is_dict()) return false;
  for (const auto [key, item] : value.GetDict()) {
    if (key == "password" && item.is_string() && !item.GetString().empty()) return true;
    if (key == "credentials" && item.is_list() && !item.GetList().empty()) return true;
    if (ValueLeaks(item, secrets)) return true;
  }
  return false;
}

}

bool ReplyLeaksSecret(const base::Value& reply, const std::vector<Credential>& credentials) {
  std::set<std::string_view> secrets;
  for (const Credential& credential : credentials) {
    if (credential.password.size() >= kExactSecretBytes) secrets.insert(credential.password);
  }
  return ValueLeaks(reply, secrets);
}

std::string ExistingKey(std::string_view url, std::string_view username, std::string_view password) {
  std::string key = OriginOf(url);
  key.push_back('\0');
  key += username;
  key.push_back('\0');
  key += password;
  return key;
}

size_t CountExisting(const std::vector<Credential>& chunk, const std::set<std::string>& existing) {
  size_t found = 0;
  for (const Credential& credential : chunk) {
    std::string key = ExistingKey(credential.url, credential.username, credential.password);
    if (existing.contains(key)) ++found;
    Wipe(key);
  }
  return found;
}

void PasswordTally::AddChunk(size_t number_imported, size_t existing_in_chunk, int chunk_conflicts, int chunk_invalid) {
  const size_t present = std::min(existing_in_chunk, number_imported);
  added += static_cast<int>(number_imported - present);
  existing += static_cast<int>(present);
  conflicts += chunk_conflicts;
  invalid += chunk_invalid;
}

base::DictValue PasswordTally::ToValue() const {
  base::DictValue value;
  value.Set("added", added);
  value.Set("existing", existing);
  value.Set("conflicts", conflicts);
  value.Set("invalid", invalid);
  return value;
}

std::vector<FirefoxProfileEntry> ParseProfilesIni(std::string_view ini) {
  struct Section {
    std::string name;
    std::vector<std::pair<std::string, std::string>> values;
    std::string Get(std::string_view key) const {
      for (const auto& [k, v] : values) {
        if (k == key) return v;
      }
      return {};
    }
    bool Has(std::string_view key) const {
      for (const auto& [k, v] : values) {
        if (k == key) return true;
      }
      return false;
    }
  };
  std::vector<Section> sections;
  size_t start = 0;
  while (start <= ini.size()) {
    const size_t end = ini.find_first_of("\r\n", start);
    const std::string_view line = Trim(ini.substr(start, end == std::string_view::npos ? std::string_view::npos : end - start));
    start = end == std::string_view::npos ? ini.size() + 1 : end + 1;
    if (line.empty() || line[0] == ';' || line[0] == '#') continue;
    if (line.front() == '[' && line.back() == ']' && line.size() >= 2) {
      sections.push_back({std::string(line.substr(1, line.size() - 2)), {}});
    } else if (const size_t eq = line.find('='); eq != std::string_view::npos && !sections.empty()) {
      sections.back().values.emplace_back(std::string(line.substr(0, eq)), std::string(line.substr(eq + 1)));
    }
  }
  std::set<std::string> install_defaults;
  for (const Section& section : sections) {
    if (section.name.rfind("Install", 0) == 0 && section.Has("Default")) install_defaults.insert(section.Get("Default"));
  }
  std::vector<FirefoxProfileEntry> profiles;
  for (const Section& section : sections) {
    if (section.name.rfind("Profile", 0) != 0) continue;
    const std::string path = section.Get("Path");
    if (path.empty()) continue;
    FirefoxProfileEntry entry;
    entry.path = path;
    entry.name = section.Has("Name") ? section.Get("Name") : path;
    entry.relative = section.Get("IsRelative") != "0";
    entry.is_default = install_defaults.empty() ? section.Get("Default") == "1" : install_defaults.contains(path);
    profiles.push_back(std::move(entry));
  }
  std::stable_sort(profiles.begin(), profiles.end(),
                   [](const FirefoxProfileEntry& a, const FirefoxProfileEntry& b) { return a.is_default && !b.is_default; });
  return profiles;
}

ProfileTarget ClassifyProfile(std::string_view profile) {
  if (profile.empty() || profile == "default") return ProfileTarget::kDefault;
  if (profile.rfind("incognito:", 0) == 0) return ProfileTarget::kPrivate;
  if (profile.size() > 128 || LowerAscii(profile) == "default") return ProfileTarget::kInvalid;
  const char first = profile[0];
  if (!((first >= 'a' && first <= 'z') || (first >= 'A' && first <= 'Z'))) return ProfileTarget::kInvalid;
  for (char c : profile) {
    if (!IsAlnum(c) && c != '_' && c != '-') return ProfileTarget::kInvalid;
  }
  return ProfileTarget::kIsolated;
}

std::string ProfileErrorCode(ProfileTarget target) {
  switch (target) {
    case ProfileTarget::kDefault: return {};
    case ProfileTarget::kPrivate: return "ERR_PROFILE_PRIVATE";
    case ProfileTarget::kIsolated: return "ERR_PROFILE_UNAVAILABLE";
    case ProfileTarget::kInvalid: return "ERR_PROFILE_INVALID";
  }
  return "ERR_PROFILE_INVALID";
}

bool ValidJobId(std::string_view id) {
  if (id.empty() || id.size() > 64) return false;
  return std::all_of(id.begin(), id.end(), [](char c) { return IsAlnum(c) || c == '_' || c == '-' || c == '.' || c == ':'; });
}

bool ValidBrowserId(std::string_view id) {
  return !id.empty() && id.size() <= 32 && std::all_of(id.begin(), id.end(), IsAlnum);
}

bool ValidProfileId(std::string_view id) {
  if (id == ".") return true;
  if (id.empty() || id.size() > 255 || id.front() == '/' || id.back() == '/') return false;
  size_t start = 0;
  while (start <= id.size()) {
    const size_t end = id.find('/', start);
    const std::string_view part = id.substr(start, end == std::string_view::npos ? std::string_view::npos : end - start);
    if (part.empty() || part == "." || part == "..") return false;
    for (char c : part) {
      if (static_cast<unsigned char>(c) < 0x20) return false;
    }
    if (end == std::string_view::npos) break;
    start = end + 1;
  }
  return true;
}

bool ValidToken(std::string_view token) {
  return token.size() == 32 &&
         std::all_of(token.begin(), token.end(), [](char c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'); });
}

bool ValidKind(std::string_view kind) {
  return std::any_of(std::begin(kKinds), std::end(kKinds), [kind](const char* known) { return kind == known; });
}

std::vector<std::string> RequestedKinds(const base::ListValue* kinds) {
  std::vector<std::string> out;
  if (!kinds) return out;
  for (const base::Value& kind : *kinds) {
    if (!kind.is_string() || !ValidKind(kind.GetString())) continue;
    if (std::find(out.begin(), out.end(), kind.GetString()) == out.end()) out.push_back(kind.GetString());
  }
  return out;
}

bool ValidChooserKind(std::string_view kind) {
  return kind == "bookmarksHTML" || kind == "passwordsCSV";
}

bool ValidLocalFile(std::string_view path) {
  return !path.empty() && path.front() == '/' && path.size() <= kMaxPathBytes && path.find('\0') == std::string_view::npos;
}

ChosenFiles::ChosenFiles() = default;
ChosenFiles::~ChosenFiles() = default;

void ChosenFiles::Remember(std::string_view owner, std::string_view kind, std::string_view path, double now) {
  std::erase_if(entries_, [&](const Entry& entry) {
    return entry.at + kChosenFileLifetimeMs <= now || (entry.owner == owner && entry.kind == kind && entry.path == path);
  });
  entries_.push_back({std::string(owner), std::string(kind), std::string(path), now});
  while (entries_.size() > kChosenFiles) entries_.erase(entries_.begin());
}

bool ChosenFiles::Take(std::string_view owner, std::string_view kind, std::string_view path, double now) {
  std::erase_if(entries_, [now](const Entry& entry) { return entry.at + kChosenFileLifetimeMs <= now; });
  const auto found = std::find_if(entries_.begin(), entries_.end(), [&](const Entry& entry) {
    return entry.owner == owner && entry.kind == kind && entry.path == path;
  });
  if (found == entries_.end()) return false;
  entries_.erase(found);
  return true;
}

void ChosenFiles::Forget(std::string_view owner) {
  std::erase_if(entries_, [owner](const Entry& entry) { return entry.owner == owner; });
}

CredentialVault::CredentialVault() = default;

CredentialVault::~CredentialVault() {
  Clear();
}

bool CredentialVault::Put(std::string_view owner, std::string_view token, std::vector<Credential> credentials,
                          double now) {
  if (owner.empty() || !ValidToken(token)) return false;
  Expire(now);
  if (std::any_of(entries_.begin(), entries_.end(), [token](const Entry& entry) { return entry.token == token; })) {
    return false;
  }
  while (std::count_if(entries_.begin(), entries_.end(), [owner](const Entry& entry) { return entry.owner == owner; }) >=
         static_cast<std::ptrdiff_t>(kVaultEntriesPerOwner)) {
    entries_.erase(std::find_if(entries_.begin(), entries_.end(), [owner](const Entry& entry) { return entry.owner == owner; }));
  }
  entries_.push_back({std::string(owner), std::string(token), std::move(credentials), now});
  return true;
}

bool CredentialVault::Contains(std::string_view owner, std::string_view token, double now) {
  Expire(now);
  return std::any_of(entries_.begin(), entries_.end(),
                     [&](const Entry& entry) { return entry.owner == owner && entry.token == token; });
}

std::optional<double> CredentialVault::NextExpiry() const {
  std::optional<double> next;
  for (const Entry& entry : entries_) {
    const double at = entry.at + kVaultLifetimeMs;
    if (!next || at < *next) next = at;
  }
  return next;
}

std::optional<std::vector<Credential>> CredentialVault::Take(std::string_view owner, std::string_view token, double now) {
  Expire(now);
  const auto found = std::find_if(entries_.begin(), entries_.end(), [&](const Entry& entry) {
    return entry.owner == owner && entry.token == token;
  });
  if (found == entries_.end()) return std::nullopt;
  std::vector<Credential> credentials = std::move(found->credentials);
  entries_.erase(found);
  return credentials;
}

bool CredentialVault::Discard(std::string_view owner, std::string_view token) {
  return std::erase_if(entries_, [&](const Entry& entry) { return entry.owner == owner && entry.token == token; }) > 0;
}

void CredentialVault::DiscardOwner(std::string_view owner) {
  std::erase_if(entries_, [owner](const Entry& entry) { return entry.owner == owner; });
}

void CredentialVault::Expire(double now) {
  std::erase_if(entries_, [now](const Entry& entry) { return entry.at + kVaultLifetimeMs <= now; });
}

void CredentialVault::Clear() {
  entries_.clear();
}

}
