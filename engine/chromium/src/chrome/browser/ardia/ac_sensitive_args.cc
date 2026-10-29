// Copyright 2026 Ardia. Apache-2.0.

#include "chrome/browser/ardia/ac_sensitive_args.h"

#include <algorithm>
#include <cstdint>
#include <utility>

#include "base/json/json_writer.h"
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

#if BUILDFLAG(IS_LINUX)
namespace {

constexpr size_t kMaxEscapedBytesPerByte = 6;
constexpr size_t kScalarBound = 32;
constexpr size_t kMinimumJsonCapacity = 1024;
constexpr size_t kMaxUTF8BytesPerUTF16Unit = 3;

size_t EscapedBound(std::string_view text) {
  return kMaxEscapedBytesPerByte * text.size() + 2;
}

size_t JsonBound(const base::Value& value) {
  if (value.is_string()) {
    return EscapedBound(value.GetString());
  }
  size_t bound = 2;
  if (value.is_dict()) {
    for (const auto [key, child] : value.GetDict()) {
      bound += EscapedBound(key) + 2 + JsonBound(child);
    }
    return bound;
  }
  if (value.is_list()) {
    for (const base::Value& child : value.GetList()) {
      bound += 1 + JsonBound(child);
    }
    return bound;
  }
  return kScalarBound;
}

}

std::string SecretUTF8(std::u16string_view text) {
  std::string utf8;
  utf8.reserve(kMaxUTF8BytesPerUTF16Unit * text.size());
  for (size_t i = 0; i < text.size(); ++i) {
    uint32_t code_point = text[i];
    const bool lead = code_point >= 0xD800 && code_point <= 0xDBFF;
    if (lead && i + 1 < text.size() && text[i + 1] >= 0xDC00 && text[i + 1] <= 0xDFFF) {
      code_point = 0x10000 + ((code_point - 0xD800) << 10) + (text[i + 1] - 0xDC00);
      ++i;
    } else if (code_point >= 0xD800 && code_point <= 0xDFFF) {
      code_point = 0xFFFD;
    }
    if (code_point < 0x80) {
      utf8.push_back(static_cast<char>(code_point));
    } else if (code_point < 0x800) {
      utf8.push_back(static_cast<char>(0xC0 | (code_point >> 6)));
      utf8.push_back(static_cast<char>(0x80 | (code_point & 0x3F)));
    } else if (code_point < 0x10000) {
      utf8.push_back(static_cast<char>(0xE0 | (code_point >> 12)));
      utf8.push_back(static_cast<char>(0x80 | ((code_point >> 6) & 0x3F)));
      utf8.push_back(static_cast<char>(0x80 | (code_point & 0x3F)));
    } else {
      utf8.push_back(static_cast<char>(0xF0 | (code_point >> 18)));
      utf8.push_back(static_cast<char>(0x80 | ((code_point >> 12) & 0x3F)));
      utf8.push_back(static_cast<char>(0x80 | ((code_point >> 6) & 0x3F)));
      utf8.push_back(static_cast<char>(0x80 | (code_point & 0x3F)));
    }
  }
  return utf8;
}

void SendSecretJson(base::DictValue result,
                    void (*send)(void* context, const char* json),
                    void* context) {
  base::Value value(std::move(result));
  std::string json;
  json.reserve(std::max(JsonBound(value) + kScalarBound, kMinimumJsonCapacity));
  const bool written = base::JSONWriter::Write(value, &json);
  send(context, written ? json.c_str() : "{}");
  Cleanse(json);
  Cleanse(value);
}
#endif

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
