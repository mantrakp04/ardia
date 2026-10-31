#pragma once
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <variant>
#include <vector>

namespace base {
class DictValue;
class ListValue;

class Value {
 public:
  enum class Type { NONE, BOOLEAN, INT, DOUBLE, STRING, DICT, LIST };
  Value() = default;
  explicit Value(bool value) : value_(value) {}
  explicit Value(int value) : value_(value) {}
  explicit Value(double value) : value_(value) {}
  explicit Value(const char* value) : value_(std::string(value)) {}
  explicit Value(std::string_view value) : value_(std::string(value)) {}
  explicit Value(std::string&& value) : value_(std::move(value)) {}
  explicit Value(DictValue&& value);
  explicit Value(ListValue&& value);
  Value(Value&&) = default;
  Value& operator=(Value&&) = default;
  Value(const Value&) = delete;
  Value& operator=(const Value&) = delete;

  Type type() const { return static_cast<Type>(value_.index()); }
  bool is_none() const { return type() == Type::NONE; }
  bool is_bool() const { return type() == Type::BOOLEAN; }
  bool is_int() const { return type() == Type::INT; }
  bool is_double() const { return type() == Type::DOUBLE; }
  bool is_string() const { return type() == Type::STRING; }
  bool is_dict() const { return type() == Type::DICT; }
  bool is_list() const { return type() == Type::LIST; }
  bool GetBool() const { return std::get<bool>(value_); }
  int GetInt() const { return std::get<int>(value_); }
  double GetDouble() const { return is_int() ? std::get<int>(value_) : std::get<double>(value_); }
  const std::string& GetString() const { return std::get<std::string>(value_); }
  std::string& GetString() { return std::get<std::string>(value_); }
  DictValue& GetDict() { return *std::get<std::unique_ptr<DictValue>>(value_); }
  const DictValue& GetDict() const { return *std::get<std::unique_ptr<DictValue>>(value_); }
  ListValue& GetList() { return *std::get<std::unique_ptr<ListValue>>(value_); }
  const ListValue& GetList() const { return *std::get<std::unique_ptr<ListValue>>(value_); }
  Value Clone() const;

 private:
  std::variant<std::monostate, bool, int, double, std::string, std::unique_ptr<DictValue>, std::unique_ptr<ListValue>> value_;
};

class DictValue {
 public:
  using Storage = std::map<std::string, Value, std::less<>>;
  class const_iterator {
   public:
    explicit const_iterator(Storage::const_iterator it) : it_(it) {}
    std::pair<const std::string&, const Value&> operator*() const { return {it_->first, it_->second}; }
    const_iterator& operator++() { ++it_; return *this; }
    bool operator!=(const const_iterator& other) const { return it_ != other.it_; }
    bool operator==(const const_iterator& other) const { return it_ == other.it_; }
   private:
    Storage::const_iterator it_;
  };

  DictValue() = default;
  DictValue(DictValue&&) = default;
  DictValue& operator=(DictValue&&) = default;
  DictValue(const DictValue&) = delete;
  DictValue& operator=(const DictValue&) = delete;

  const_iterator begin() const { return const_iterator(entries_.begin()); }
  const_iterator end() const { return const_iterator(entries_.end()); }
  size_t size() const { return entries_.size(); }
  bool empty() const { return entries_.empty(); }
  bool contains(std::string_view key) const { return entries_.find(key) != entries_.end(); }

  const Value* Find(std::string_view key) const {
    auto found = entries_.find(key);
    return found == entries_.end() ? nullptr : &found->second;
  }
  Value* Find(std::string_view key) {
    auto found = entries_.find(key);
    return found == entries_.end() ? nullptr : &found->second;
  }
  std::optional<bool> FindBool(std::string_view key) const {
    const Value* v = Find(key);
    return v && v->is_bool() ? std::optional<bool>(v->GetBool()) : std::nullopt;
  }
  std::optional<int> FindInt(std::string_view key) const {
    const Value* v = Find(key);
    return v && v->is_int() ? std::optional<int>(v->GetInt()) : std::nullopt;
  }
  std::optional<double> FindDouble(std::string_view key) const {
    const Value* v = Find(key);
    return v && (v->is_int() || v->is_double()) ? std::optional<double>(v->GetDouble()) : std::nullopt;
  }
  const std::string* FindString(std::string_view key) const {
    const Value* v = Find(key);
    return v && v->is_string() ? &v->GetString() : nullptr;
  }
  std::string* FindString(std::string_view key) {
    Value* v = Find(key);
    return v && v->is_string() ? &v->GetString() : nullptr;
  }
  const DictValue* FindDict(std::string_view key) const {
    const Value* v = Find(key);
    return v && v->is_dict() ? &v->GetDict() : nullptr;
  }
  DictValue* FindDict(std::string_view key) {
    Value* v = Find(key);
    return v && v->is_dict() ? &v->GetDict() : nullptr;
  }
  const ListValue* FindList(std::string_view key) const {
    const Value* v = Find(key);
    return v && v->is_list() ? &v->GetList() : nullptr;
  }
  ListValue* FindList(std::string_view key) {
    Value* v = Find(key);
    return v && v->is_list() ? &v->GetList() : nullptr;
  }

  Value* Set(std::string_view key, Value&& value) {
    auto [entry, inserted] = entries_.insert_or_assign(std::string(key), std::move(value));
    return &entry->second;
  }
  Value* Set(std::string_view key, bool value) { return Set(key, Value(value)); }
  Value* Set(std::string_view key, int value) { return Set(key, Value(value)); }
  Value* Set(std::string_view key, double value) { return Set(key, Value(value)); }
  Value* Set(std::string_view key, std::string_view value) { return Set(key, Value(value)); }
  Value* Set(std::string_view key, const char* value) { return Set(key, Value(value)); }
  Value* Set(std::string_view key, std::string&& value) { return Set(key, Value(std::move(value))); }
  Value* Set(std::string_view key, DictValue&& value) { return Set(key, Value(std::move(value))); }
  Value* Set(std::string_view key, ListValue&& value) { return Set(key, Value(std::move(value))); }
  bool Remove(std::string_view key) {
    auto found = entries_.find(key);
    if (found == entries_.end()) return false;
    entries_.erase(found);
    return true;
  }
  DictValue Clone() const;

 private:
  Storage entries_;
};

class ListValue {
 public:
  ListValue() = default;
  ListValue(ListValue&&) = default;
  ListValue& operator=(ListValue&&) = default;
  ListValue(const ListValue&) = delete;
  ListValue& operator=(const ListValue&) = delete;

  auto begin() { return entries_.begin(); }
  auto end() { return entries_.end(); }
  auto begin() const { return entries_.begin(); }
  auto end() const { return entries_.end(); }
  size_t size() const { return entries_.size(); }
  bool empty() const { return entries_.empty(); }
  const Value& operator[](size_t index) const { return entries_[index]; }
  Value& operator[](size_t index) { return entries_[index]; }

  void Append(Value&& value) { entries_.push_back(std::move(value)); }
  void Append(bool value) { Append(Value(value)); }
  void Append(int value) { Append(Value(value)); }
  void Append(double value) { Append(Value(value)); }
  void Append(std::string_view value) { Append(Value(value)); }
  void Append(const char* value) { Append(Value(value)); }
  void Append(std::string&& value) { Append(Value(std::move(value))); }
  void Append(DictValue&& value) { Append(Value(std::move(value))); }
  void Append(ListValue&& value) { Append(Value(std::move(value))); }
  ListValue Clone() const;

 private:
  std::vector<Value> entries_;
};

inline Value::Value(DictValue&& value) : value_(std::make_unique<DictValue>(std::move(value))) {}
inline Value::Value(ListValue&& value) : value_(std::make_unique<ListValue>(std::move(value))) {}

inline DictValue DictValue::Clone() const {
  DictValue copy;
  for (const auto& [key, value] : entries_) copy.Set(key, value.Clone());
  return copy;
}

inline ListValue ListValue::Clone() const {
  ListValue copy;
  for (const Value& value : entries_) copy.Append(value.Clone());
  return copy;
}

inline Value Value::Clone() const {
  switch (type()) {
    case Type::NONE: return Value();
    case Type::BOOLEAN: return Value(GetBool());
    case Type::INT: return Value(GetInt());
    case Type::DOUBLE: return Value(GetDouble());
    case Type::STRING: return Value(std::string_view(GetString()));
    case Type::DICT: return Value(GetDict().Clone());
    case Type::LIST: return Value(GetList().Clone());
  }
  return Value();
}

enum JSONParserOptions { JSON_PARSE_RFC = 0 };

class JSONReader {
 public:
  static std::optional<Value> Read(std::string_view json, int = 0) {
    JSONReader reader(json);
    reader.Space();
    std::optional<Value> value = reader.Parse(0);
    reader.Space();
    if (!value || reader.i_ != json.size()) return std::nullopt;
    return value;
  }
  static std::optional<DictValue> ReadDict(std::string_view json, int options = 0) {
    std::optional<Value> value = Read(json, options);
    if (!value || !value->is_dict()) return std::nullopt;
    return std::move(value->GetDict());
  }

 private:
  explicit JSONReader(std::string_view s) : s_(s) {}
  void Space() {
    while (i_ < s_.size() && (s_[i_] == ' ' || s_[i_] == '\n' || s_[i_] == '\r' || s_[i_] == '\t')) ++i_;
  }
  bool Literal(std::string_view word) {
    if (s_.substr(i_, word.size()) != word) return false;
    i_ += word.size();
    return true;
  }
  static void Utf8(std::string& out, uint32_t c) {
    if (c < 0x80) out.push_back(static_cast<char>(c));
    else if (c < 0x800) { out.push_back(static_cast<char>(0xC0 | (c >> 6))); out.push_back(static_cast<char>(0x80 | (c & 0x3F))); }
    else if (c < 0x10000) { out.push_back(static_cast<char>(0xE0 | (c >> 12))); out.push_back(static_cast<char>(0x80 | ((c >> 6) & 0x3F))); out.push_back(static_cast<char>(0x80 | (c & 0x3F))); }
    else { out.push_back(static_cast<char>(0xF0 | (c >> 18))); out.push_back(static_cast<char>(0x80 | ((c >> 12) & 0x3F))); out.push_back(static_cast<char>(0x80 | ((c >> 6) & 0x3F))); out.push_back(static_cast<char>(0x80 | (c & 0x3F))); }
  }
  bool Hex4(uint32_t* out) {
    if (i_ + 4 > s_.size()) return false;
    uint32_t v = 0;
    for (int k = 0; k < 4; ++k) {
      const char c = s_[i_++];
      v <<= 4;
      if (c >= '0' && c <= '9') v |= c - '0';
      else if (c >= 'a' && c <= 'f') v |= c - 'a' + 10;
      else if (c >= 'A' && c <= 'F') v |= c - 'A' + 10;
      else return false;
    }
    *out = v;
    return true;
  }
  std::optional<std::string> String() {
    if (i_ >= s_.size() || s_[i_] != '"') return std::nullopt;
    ++i_;
    std::string out;
    while (i_ < s_.size() && s_[i_] != '"') {
      char c = s_[i_++];
      if (static_cast<unsigned char>(c) < 0x20) return std::nullopt;
      if (c != '\\') { out.push_back(c); continue; }
      if (i_ >= s_.size()) return std::nullopt;
      c = s_[i_++];
      switch (c) {
        case '"': out.push_back('"'); break;
        case '\\': out.push_back('\\'); break;
        case '/': out.push_back('/'); break;
        case 'b': out.push_back('\b'); break;
        case 'f': out.push_back('\f'); break;
        case 'n': out.push_back('\n'); break;
        case 'r': out.push_back('\r'); break;
        case 't': out.push_back('\t'); break;
        case 'u': {
          uint32_t code = 0;
          if (!Hex4(&code)) return std::nullopt;
          if (code >= 0xD800 && code <= 0xDBFF && s_.substr(i_, 2) == "\\u") {
            i_ += 2;
            uint32_t low = 0;
            if (!Hex4(&low) || low < 0xDC00 || low > 0xDFFF) return std::nullopt;
            code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
          }
          Utf8(out, code);
          break;
        }
        default: return std::nullopt;
      }
    }
    if (i_ >= s_.size()) return std::nullopt;
    ++i_;
    return out;
  }
  std::optional<Value> Parse(int depth) {
    if (depth > 200 || i_ >= s_.size()) return std::nullopt;
    const char c = s_[i_];
    if (c == '{') {
      ++i_;
      DictValue dict;
      Space();
      if (i_ < s_.size() && s_[i_] == '}') { ++i_; return Value(std::move(dict)); }
      while (true) {
        Space();
        std::optional<std::string> key = String();
        if (!key) return std::nullopt;
        Space();
        if (i_ >= s_.size() || s_[i_] != ':') return std::nullopt;
        ++i_;
        Space();
        std::optional<Value> value = Parse(depth + 1);
        if (!value) return std::nullopt;
        dict.Set(*key, std::move(*value));
        Space();
        if (i_ < s_.size() && s_[i_] == ',') { ++i_; continue; }
        if (i_ < s_.size() && s_[i_] == '}') { ++i_; return Value(std::move(dict)); }
        return std::nullopt;
      }
    }
    if (c == '[') {
      ++i_;
      ListValue list;
      Space();
      if (i_ < s_.size() && s_[i_] == ']') { ++i_; return Value(std::move(list)); }
      while (true) {
        Space();
        std::optional<Value> value = Parse(depth + 1);
        if (!value) return std::nullopt;
        list.Append(std::move(*value));
        Space();
        if (i_ < s_.size() && s_[i_] == ',') { ++i_; continue; }
        if (i_ < s_.size() && s_[i_] == ']') { ++i_; return Value(std::move(list)); }
        return std::nullopt;
      }
    }
    if (c == '"') {
      std::optional<std::string> text = String();
      if (!text) return std::nullopt;
      return Value(std::move(*text));
    }
    if (Literal("true")) return Value(true);
    if (Literal("false")) return Value(false);
    if (Literal("null")) return Value();
    const size_t start = i_;
    if (i_ < s_.size() && s_[i_] == '-') ++i_;
    bool fraction = false;
    while (i_ < s_.size() && ((s_[i_] >= '0' && s_[i_] <= '9') || s_[i_] == '.' || s_[i_] == 'e' || s_[i_] == 'E' || s_[i_] == '+' || s_[i_] == '-')) {
      if (s_[i_] == '.' || s_[i_] == 'e' || s_[i_] == 'E') fraction = true;
      ++i_;
    }
    if (start == i_) return std::nullopt;
    const std::string number(s_.substr(start, i_ - start));
    const double value = std::strtod(number.c_str(), nullptr);
    if (!fraction && value >= -2147483648.0 && value <= 2147483647.0) return Value(static_cast<int>(value));
    return Value(value);
  }

  std::string_view s_;
  size_t i_ = 0;
};

inline void WriteJson(const Value& value, std::string& out);

inline void WriteString(std::string_view text, std::string& out) {
  out.push_back('"');
  for (char c : text) {
    if (c == '"' || c == '\\') { out.push_back('\\'); out.push_back(c); }
    else if (c == '\n') out += "\\n";
    else if (c == '\r') out += "\\r";
    else if (c == '\t') out += "\\t";
    else if (static_cast<unsigned char>(c) < 0x20) { char buffer[8]; std::snprintf(buffer, sizeof(buffer), "\\u%04x", c); out += buffer; }
    else out.push_back(c);
  }
  out.push_back('"');
}

inline void WriteJson(const DictValue& dict, std::string& out) {
  out.push_back('{');
  bool first = true;
  for (const auto [key, value] : dict) {
    if (!first) out.push_back(',');
    first = false;
    WriteString(key, out);
    out.push_back(':');
    WriteJson(value, out);
  }
  out.push_back('}');
}

inline void WriteJson(const ListValue& list, std::string& out) {
  out.push_back('[');
  bool first = true;
  for (const Value& value : list) {
    if (!first) out.push_back(',');
    first = false;
    WriteJson(value, out);
  }
  out.push_back(']');
}

inline void WriteJson(const Value& value, std::string& out) {
  switch (value.type()) {
    case Value::Type::NONE: out += "null"; break;
    case Value::Type::BOOLEAN: out += value.GetBool() ? "true" : "false"; break;
    case Value::Type::INT: out += std::to_string(value.GetInt()); break;
    case Value::Type::DOUBLE: {
      char buffer[64];
      std::snprintf(buffer, sizeof(buffer), "%.17g", value.GetDouble());
      out += buffer;
      break;
    }
    case Value::Type::STRING: WriteString(value.GetString(), out); break;
    case Value::Type::DICT: WriteJson(value.GetDict(), out); break;
    case Value::Type::LIST: WriteJson(value.GetList(), out); break;
  }
}

template <typename T>
std::string ToJson(const T& value) {
  std::string out;
  WriteJson(value, out);
  return out;
}

}
