#pragma once
#include <string>
#include <utility>
namespace password_manager {
class PasswordString {
 public:
  PasswordString() = default;
  explicit PasswordString(std::u16string&& plaintext) : value_(std::move(plaintext)) {}
  std::u16string value() const { return value_; }
  bool empty() const { return value_.empty(); }
  void clear() { value_.clear(); }
  friend bool operator==(const PasswordString& lhs, const std::u16string& rhs) { return lhs.value_ == rhs; }

 private:
  std::u16string value_;
};
}
