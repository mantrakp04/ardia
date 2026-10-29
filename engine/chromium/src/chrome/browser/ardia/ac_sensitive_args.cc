// Copyright 2026 Ardia. Apache-2.0.

#include "chrome/browser/ardia/ac_sensitive_args.h"

#include <utility>

#include "third_party/boringssl/src/include/openssl/mem.h"

namespace ardia {

void Cleanse(std::string& string) {
  string.resize(string.capacity());
  OPENSSL_cleanse(string.data(), string.size());
  string.clear();
}

void Cleanse(std::u16string& string) {
  string.resize(string.capacity());
  OPENSSL_cleanse(string.data(), string.size() * sizeof(char16_t));
  string.clear();
}

void Cleanse(base::Value& value) {
  if (value.is_string()) {
    Cleanse(value.GetString());
  } else if (value.is_dict()) {
    for (auto [key, child] : value.GetDict()) {
      Cleanse(child);
    }
  } else if (value.is_list()) {
    for (base::Value& child : value.GetList()) {
      Cleanse(child);
    }
  }
}

Secret::Secret() = default;

Secret::Secret(const std::string* value)
    : value_(value ? *value : std::string()), present_(value != nullptr) {}

Secret::Secret(std::string&& value)
    : value_(std::move(value)), present_(true) {
  Cleanse(value);
}

Secret::Secret(const Secret& other) = default;

Secret::Secret(Secret&& other)
    : value_(std::move(other.value_)), present_(other.present_) {
  Cleanse(other.value_);
}

Secret& Secret::operator=(const Secret& other) {
  if (this != &other) {
    Cleanse(value_);
    value_ = other.value_;
    present_ = other.present_;
  }
  return *this;
}

Secret& Secret::operator=(Secret&& other) {
  if (this != &other) {
    Cleanse(value_);
    value_ = std::move(other.value_);
    present_ = other.present_;
    Cleanse(other.value_);
  }
  return *this;
}

Secret::~Secret() {
  Cleanse(value_);
}

}
