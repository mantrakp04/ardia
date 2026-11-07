#pragma once
#include <string>
#include <utility>
namespace dbus {
class ObjectPath {
 public:
  explicit ObjectPath(std::string value) : value_(std::move(value)) {}
  const std::string& value() const { return value_; }

 private:
  std::string value_;
};
}
