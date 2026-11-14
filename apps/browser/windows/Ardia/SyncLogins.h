#pragma once

#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <vector>

#include "SyncCrypto.h"

namespace Ardia::SyncLogins {

using SyncCrypto::WipedString;

struct Node {
  enum class Kind { Object, Array, String, Number, Literal } kind = Kind::Literal;
  size_t begin = 0;
  size_t end = 0;
  std::vector<std::pair<std::string, Node>> members;
  std::vector<Node> items;
};

class Reader {
 public:
  explicit Reader(std::string_view text) noexcept : m_text(text) {}

  std::optional<Node> Document() {
    Node node;
    Space();
    if (!Value(node, 0)) return std::nullopt;
    Space();
    if (m_at != m_text.size()) return std::nullopt;
    return node;
  }

  static std::optional<WipedString> Decoded(std::string_view text, Node const &node) {
    if (node.kind != Node::Kind::String) return std::nullopt;
    Reader reader(text);
    reader.m_at = node.begin;
    WipedString out;
    if (!reader.StringBody(&out.text())) return std::nullopt;
    return out;
  }

 private:
  static constexpr int DeepestNesting = 512;

  void Space() noexcept {
    while (m_at < m_text.size() && (m_text[m_at] == ' ' || m_text[m_at] == '\t' || m_text[m_at] == '\n' || m_text[m_at] == '\r')) m_at++;
  }

  bool Take(char c) noexcept {
    if (m_at >= m_text.size() || m_text[m_at] != c) return false;
    m_at++;
    return true;
  }

  bool Value(Node &node, int depth) {
    if (depth > DeepestNesting || m_at >= m_text.size()) return false;
    node.begin = m_at;
    char c = m_text[m_at];
    bool ok = c == '{' ? Object(node, depth) : c == '[' ? Array(node, depth) : c == '"' ? String(node) : (c == '-' || (c >= '0' && c <= '9')) ? Number(node) : Literal(node);
    node.end = m_at;
    return ok;
  }

  bool Object(Node &node, int depth) {
    node.kind = Node::Kind::Object;
    m_at++;
    Space();
    if (Take('}')) return true;
    while (true) {
      Space();
      std::string name;
      if (m_at >= m_text.size() || m_text[m_at] != '"' || !StringBody(&name)) return false;
      Space();
      if (!Take(':')) return false;
      Space();
      Node value;
      if (!Value(value, depth + 1)) return false;
      node.members.emplace_back(std::move(name), std::move(value));
      Space();
      if (Take('}')) return true;
      if (!Take(',')) return false;
    }
  }

  bool Array(Node &node, int depth) {
    node.kind = Node::Kind::Array;
    m_at++;
    Space();
    if (Take(']')) return true;
    while (true) {
      Space();
      Node item;
      if (!Value(item, depth + 1)) return false;
      node.items.push_back(std::move(item));
      Space();
      if (Take(']')) return true;
      if (!Take(',')) return false;
    }
  }

  bool String(Node &node) {
    node.kind = Node::Kind::String;
    return StringBody(nullptr);
  }

  bool Number(Node &node) {
    node.kind = Node::Kind::Number;
    size_t start = m_at;
    Take('-');
    size_t digits = m_at;
    while (m_at < m_text.size() && m_text[m_at] >= '0' && m_text[m_at] <= '9') m_at++;
    if (m_at == digits) return false;
    if (Take('.')) {
      size_t fraction = m_at;
      while (m_at < m_text.size() && m_text[m_at] >= '0' && m_text[m_at] <= '9') m_at++;
      if (m_at == fraction) return false;
    }
    if (m_at < m_text.size() && (m_text[m_at] == 'e' || m_text[m_at] == 'E')) {
      m_at++;
      if (!Take('+')) Take('-');
      size_t exponent = m_at;
      while (m_at < m_text.size() && m_text[m_at] >= '0' && m_text[m_at] <= '9') m_at++;
      if (m_at == exponent) return false;
    }
    return m_at > start;
  }

  bool Literal(Node &node) {
    node.kind = Node::Kind::Literal;
    for (std::string_view word : {std::string_view{"true"}, std::string_view{"false"}, std::string_view{"null"}}) {
      if (m_text.substr(m_at, word.size()) == word) {
        m_at += word.size();
        return true;
      }
    }
    return false;
  }

  std::optional<unsigned> Hex4() noexcept {
    if (m_at + 4 > m_text.size()) return std::nullopt;
    unsigned value = 0;
    for (size_t i = 0; i < 4; i++) {
      char c = m_text[m_at + i];
      unsigned digit = (c >= '0' && c <= '9') ? c - '0' : (c >= 'a' && c <= 'f') ? c - 'a' + 10 : (c >= 'A' && c <= 'F') ? c - 'A' + 10 : 16;
      if (digit == 16) return std::nullopt;
      value = value * 16 + digit;
    }
    m_at += 4;
    return value;
  }

  static void Append(std::string *out, unsigned code) {
    if (!out) return;
    if (code < 0x80) {
      out->push_back(static_cast<char>(code));
    } else if (code < 0x800) {
      out->push_back(static_cast<char>(0xC0 | (code >> 6)));
      out->push_back(static_cast<char>(0x80 | (code & 0x3F)));
    } else if (code < 0x10000) {
      out->push_back(static_cast<char>(0xE0 | (code >> 12)));
      out->push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
      out->push_back(static_cast<char>(0x80 | (code & 0x3F)));
    } else {
      out->push_back(static_cast<char>(0xF0 | (code >> 18)));
      out->push_back(static_cast<char>(0x80 | ((code >> 12) & 0x3F)));
      out->push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
      out->push_back(static_cast<char>(0x80 | (code & 0x3F)));
    }
  }

  bool Escape(std::string *out) {
    if (m_at >= m_text.size()) return false;
    char c = m_text[m_at++];
    switch (c) {
      case '"': case '\\': case '/': if (out) out->push_back(c); return true;
      case 'b': if (out) out->push_back('\b'); return true;
      case 'f': if (out) out->push_back('\f'); return true;
      case 'n': if (out) out->push_back('\n'); return true;
      case 'r': if (out) out->push_back('\r'); return true;
      case 't': if (out) out->push_back('\t'); return true;
      case 'u': break;
      default: return false;
    }
    std::optional<unsigned> unit = Hex4();
    if (!unit) return false;
    if (*unit >= 0xD800 && *unit <= 0xDBFF && m_text.substr(m_at, 2) == "\\u") {
      size_t mark = m_at;
      m_at += 2;
      std::optional<unsigned> low = Hex4();
      if (low && *low >= 0xDC00 && *low <= 0xDFFF) {
        Append(out, 0x10000 + ((*unit - 0xD800) << 10) + (*low - 0xDC00));
        return true;
      }
      m_at = mark;
    }
    Append(out, (*unit >= 0xD800 && *unit <= 0xDFFF) ? 0xFFFD : *unit);
    return true;
  }

  bool StringBody(std::string *out) {
    if (!Take('"')) return false;
    while (m_at < m_text.size()) {
      unsigned char c = static_cast<unsigned char>(m_text[m_at]);
      if (c == '"') {
        m_at++;
        return true;
      }
      if (c < 0x20) return false;
      if (c == '\\') {
        m_at++;
        if (!Escape(out)) return false;
        continue;
      }
      if (out) out->push_back(static_cast<char>(c));
      m_at++;
    }
    return false;
  }

  std::string_view m_text;
  size_t m_at = 0;
};

inline void Quote(std::string &out, std::string_view text) {
  static constexpr char hex[] = "0123456789abcdef";
  out.push_back('"');
  for (unsigned char c : text) {
    if (c == '"' || c == '\\') {
      out.push_back('\\');
      out.push_back(static_cast<char>(c));
    } else if (c < 0x20) {
      out.append("\\u00");
      out.push_back(hex[c >> 4]);
      out.push_back(hex[c & 15]);
    } else {
      out.push_back(static_cast<char>(c));
    }
  }
  out.push_back('"');
}

inline Node const *Member(Node const &object, std::string_view name) noexcept {
  Node const *found = nullptr;
  for (auto const &member : object.members) {
    if (member.first == name) found = &member.second;
  }
  return found;
}

constexpr std::string_view Prefix = "pw:";

class Rewrite {
 public:
  Rewrite(std::string_view text, SyncCrypto::Keys const &keys, bool hiding) noexcept : m_text(text), m_keys(keys), m_hiding(hiding) {}

  std::optional<WipedString> Run() {
    std::optional<Node> root = Reader(m_text).Document();
    if (!root) return std::nullopt;
    WipedString out;
    out.text().reserve(m_text.size() + 256);
    if (!Walk(*root, out.text())) return std::nullopt;
    return std::move(out);
  }

 private:
  std::string_view Raw(Node const &node) const noexcept { return m_text.substr(node.begin, node.end - node.begin); }

  void Key(std::string &out, std::string const &name) const {
    Quote(out, name);
    out.push_back(':');
  }

  bool IsLoginRecord(Node const &node) const {
    Node const *key = Member(node, "k");
    if (!key || !Member(node, "v")) return false;
    std::optional<WipedString> text = Reader::Decoded(m_text, *key);
    return text && text->text().rfind(Prefix, 0) == 0;
  }

  bool Walk(Node const &node, std::string &out) const {
    if (node.kind == Node::Kind::Array) {
      out.push_back('[');
      for (size_t i = 0; i < node.items.size(); i++) {
        if (i) out.push_back(',');
        if (!Walk(node.items[i], out)) return false;
      }
      out.push_back(']');
      return true;
    }
    if (node.kind != Node::Kind::Object) {
      out.append(Raw(node));
      return true;
    }
    if (IsLoginRecord(node)) return Record(node, out);
    out.push_back('{');
    bool first = true;
    for (auto const &[name, value] : node.members) {
      bool prefixed = name.rfind(Prefix, 0) == 0;
      if (prefixed && value.kind == Node::Kind::String) continue;
      if (!first) out.push_back(',');
      first = false;
      Key(out, name);
      bool ok = !prefixed ? Walk(value, out) : (value.kind == Node::Kind::Object && Member(value, "v")) ? Record(value, out) : (out.append(Raw(value)), true);
      if (!ok) return false;
    }
    out.push_back('}');
    return true;
  }

  bool Record(Node const &record, std::string &out) const {
    Node const *login = Member(record, "v");
    out.push_back('{');
    bool first = true;
    for (auto const &[name, value] : record.members) {
      if (!first) out.push_back(',');
      first = false;
      Key(out, name);
      if (&value != login) {
        out.append(Raw(value));
      } else if (!Login(value, out)) {
        return false;
      }
    }
    out.push_back('}');
    return true;
  }

  bool Login(Node const &login, std::string &out) const {
    Node const *originNode = login.kind == Node::Kind::Object ? Member(login, "o") : nullptr;
    Node const *userNode = login.kind == Node::Kind::Object ? Member(login, "u") : nullptr;
    std::optional<WipedString> origin = originNode ? Reader::Decoded(m_text, *originNode) : std::nullopt;
    std::optional<WipedString> username = userNode ? Reader::Decoded(m_text, *userNode) : std::nullopt;
    Node const *from = login.kind == Node::Kind::Object ? Member(login, m_hiding ? "p" : "s") : nullptr;
    std::optional<WipedString> secret = from ? Reader::Decoded(m_text, *from) : std::nullopt;
    if (!origin || !username || !secret) {
      if (m_hiding && login.kind == Node::Kind::Object && Member(login, "p")) return Without(login, out);
      out.append(Raw(login));
      return true;
    }
    WipedString replaced;
    if (m_hiding) {
      std::optional<std::string> sealed = m_keys.SealPassword(secret->text(), origin->text(), username->text());
      if (!sealed) return false;
      replaced.text() = std::move(*sealed);
    } else {
      std::optional<SyncCrypto::WipedBytes> opened = m_keys.OpenPassword(secret->text(), origin->text(), username->text());
      if (!opened) return false;
      replaced.text().assign(opened->view());
    }
    out.push_back('{');
    for (auto const &[name, value] : login.members) {
      if (name == "p" || name == "s") continue;
      Key(out, name);
      out.append(Raw(value));
      out.push_back(',');
    }
    Key(out, m_hiding ? "s" : "p");
    Quote(out, replaced.text());
    out.push_back('}');
    return true;
  }

  bool Without(Node const &login, std::string &out) const {
    out.push_back('{');
    bool first = true;
    for (auto const &[name, value] : login.members) {
      if (name == "p") continue;
      if (!first) out.push_back(',');
      first = false;
      Key(out, name);
      out.append(Raw(value));
    }
    out.push_back('}');
    return true;
  }

  std::string_view m_text;
  SyncCrypto::Keys const &m_keys;
  bool m_hiding;
};

inline bool MentionsLogins(std::string_view json) noexcept { return json.find("\"pw:") != std::string_view::npos || json.find("\\u") != std::string_view::npos; }

inline std::optional<std::string> Hide(std::string_view json, SyncCrypto::Keys const &keys) {
  if (!MentionsLogins(json)) return std::string{json};
  std::optional<WipedString> hidden = Rewrite(json, keys, true).Run();
  if (!hidden) return std::nullopt;
  return std::move(hidden->text());
}

inline std::optional<WipedString> Restore(std::string_view json, SyncCrypto::Keys const &keys) {
  if (!MentionsLogins(json)) return WipedString{std::string{json}};
  return Rewrite(json, keys, false).Run();
}

inline std::optional<std::string> LoginOrigin(std::string_view realm) {
  if (!realm.empty() && realm.back() == '/') realm.remove_suffix(1);
  size_t start = realm.rfind("https://", 0) == 0 ? 8 : realm.rfind("http://", 0) == 0 ? 7 : 0;
  if (start == 0 || start == realm.size()) return std::nullopt;
  for (char c : realm.substr(start)) {
    if (c == '/' || c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v') return std::nullopt;
  }
  return std::string{realm};
}

inline std::optional<std::string> SealedLogins(std::string_view reply, SyncCrypto::Keys const &keys) {
  std::optional<Node> root = Reader(reply).Document();
  if (!root || root->kind != Node::Kind::Object) return std::nullopt;
  Node const *logins = Member(*root, "logins");
  if (!logins || logins->kind != Node::Kind::Array) return std::nullopt;
  std::string out = "[";
  std::set<std::string> seen;
  for (Node const &login : logins->items) {
    if (login.kind != Node::Kind::Object) return std::nullopt;
    Node const *realmNode = Member(login, "realm");
    Node const *userNode = Member(login, "username");
    Node const *passwordNode = Member(login, "password");
    Node const *created = Member(login, "created");
    std::optional<WipedString> realm = realmNode ? Reader::Decoded(reply, *realmNode) : std::nullopt;
    std::optional<WipedString> username = userNode ? Reader::Decoded(reply, *userNode) : std::nullopt;
    std::optional<WipedString> password = passwordNode ? Reader::Decoded(reply, *passwordNode) : std::nullopt;
    if (!realm || !username || !password || !created || created->kind != Node::Kind::Number) return std::nullopt;
    if (!seen.insert(realm->text() + std::string(1, '\0') + username->text()).second) continue;
    std::optional<std::string> origin = LoginOrigin(realm->text());
    if (!origin) continue;
    std::optional<std::string> sealed = keys.SealPassword(password->text(), *origin, username->text());
    if (!sealed) return std::nullopt;
    if (out.size() > 1) out.push_back(',');
    out.append("{\"origin\":");
    Quote(out, *origin);
    out.append(",\"username\":");
    Quote(out, username->text());
    out.append(",\"sealed\":");
    Quote(out, *sealed);
    out.append(",\"created\":");
    out.append(reply.substr(created->begin, created->end - created->begin));
    out.push_back('}');
  }
  out.push_back(']');
  return out;
}

}
