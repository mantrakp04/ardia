#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
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
  enum class Type { NONE, BOOLEAN, INTEGER, DOUBLE, STRING, BINARY, DICT, LIST };
  Value();
  explicit Value(bool value);
  explicit Value(int value);
  explicit Value(std::string_view value);
  explicit Value(const char* value);
  explicit Value(std::string&& value);
  explicit Value(DictValue&& value);
  explicit Value(ListValue&& value);
  Value(Value&&) noexcept;
  Value& operator=(Value&&) noexcept;
  ~Value();

  Type type() const;
  bool is_string() const { return type() == Type::STRING; }
  bool is_dict() const { return type() == Type::DICT; }
  bool is_list() const { return type() == Type::LIST; }
  bool GetBool() const { return std::get<bool>(data_); }
  int GetInt() const { return std::get<int>(data_); }
  std::string& GetString() { return std::get<std::string>(data_); }
  const std::string& GetString() const { return std::get<std::string>(data_); }
  DictValue& GetDict() { return *std::get<std::unique_ptr<DictValue>>(data_); }
  const DictValue& GetDict() const { return *std::get<std::unique_ptr<DictValue>>(data_); }
  ListValue& GetList() { return *std::get<std::unique_ptr<ListValue>>(data_); }
  const ListValue& GetList() const { return *std::get<std::unique_ptr<ListValue>>(data_); }
  DictValue TakeDict() &&;

 private:
  std::variant<std::monostate, bool, int, std::string, std::unique_ptr<DictValue>, std::unique_ptr<ListValue>> data_;
};

class DictValue {
 public:
  DictValue() = default;
  DictValue(DictValue&&) noexcept = default;
  DictValue& operator=(DictValue&&) noexcept = default;
  DictValue&& Set(std::string_view key, Value value) && {
    entries_.insert_or_assign(std::string(key), std::move(value));
    return std::move(*this);
  }
  DictValue& Set(std::string_view key, Value value) & {
    entries_.insert_or_assign(std::string(key), std::move(value));
    return *this;
  }
  DictValue&& Set(std::string_view key, std::string value) && { return std::move(*this).Set(key, Value(std::move(value))); }
  DictValue& Set(std::string_view key, std::string value) & { return Set(key, Value(std::move(value))); }
  DictValue&& Set(std::string_view key, const char* value) && { return std::move(*this).Set(key, Value(value)); }
  DictValue&& Set(std::string_view key, bool value) && { return std::move(*this).Set(key, Value(value)); }
  DictValue& Set(std::string_view key, bool value) & { return Set(key, Value(value)); }
  const std::string* FindString(std::string_view key) const {
    auto found = entries_.find(std::string(key));
    return found != entries_.end() && found->second.is_string() ? &found->second.GetString() : nullptr;
  }
  template <class Map, class Entry>
  class Iterator {
   public:
    using Inner = decltype(std::declval<Map&>().begin());
    explicit Iterator(Inner inner) : inner_(inner) {}
    Entry operator*() const { return Entry(inner_->first, inner_->second); }
    Iterator& operator++() {
      ++inner_;
      return *this;
    }
    bool operator!=(const Iterator& other) const { return inner_ != other.inner_; }

   private:
    Inner inner_;
  };
  using Entries = std::map<std::string, Value, std::less<>>;
  using MutableIterator = Iterator<Entries, std::pair<const std::string&, Value&>>;
  using ConstIterator = Iterator<const Entries, std::pair<const std::string&, const Value&>>;
  MutableIterator begin() { return MutableIterator(entries_.begin()); }
  MutableIterator end() { return MutableIterator(entries_.end()); }
  ConstIterator begin() const { return ConstIterator(entries_.begin()); }
  ConstIterator end() const { return ConstIterator(entries_.end()); }

 private:
  Entries entries_;
};

class ListValue {
 public:
  ListValue() = default;
  ListValue(ListValue&&) noexcept = default;
  void Append(Value value) { items_.push_back(std::move(value)); }
  auto begin() { return items_.begin(); }
  auto end() { return items_.end(); }
  auto begin() const { return items_.begin(); }
  auto end() const { return items_.end(); }

 private:
  std::vector<Value> items_;
};

inline Value::Value() = default;
inline Value::Value(bool value) : data_(value) {}
inline Value::Value(int value) : data_(value) {}
inline Value::Value(std::string_view value) : data_(std::string(value)) {}
inline Value::Value(const char* value) : data_(std::string(value)) {}
inline Value::Value(std::string&& value) : data_(std::move(value)) {}
inline Value::Value(DictValue&& value) : data_(std::make_unique<DictValue>(std::move(value))) {}
inline Value::Value(ListValue&& value) : data_(std::make_unique<ListValue>(std::move(value))) {}
inline Value::Value(Value&&) noexcept = default;
inline Value& Value::operator=(Value&&) noexcept = default;
inline Value::~Value() = default;
inline Value::Type Value::type() const {
  switch (data_.index()) {
    case 1: return Type::BOOLEAN;
    case 2: return Type::INTEGER;
    case 3: return Type::STRING;
    case 4: return Type::DICT;
    case 5: return Type::LIST;
  }
  return Type::NONE;
}
inline DictValue Value::TakeDict() && { return std::move(GetDict()); }

}
