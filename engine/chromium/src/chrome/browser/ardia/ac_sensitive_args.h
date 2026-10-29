// Copyright 2026 Ardia. Apache-2.0.

#ifndef CHROME_BROWSER_ARDIA_AC_SENSITIVE_ARGS_H_
#define CHROME_BROWSER_ARDIA_AC_SENSITIVE_ARGS_H_

#include <string>

#include "base/values.h"

namespace ardia {

void Cleanse(std::string& string);
void Cleanse(std::u16string& string);
void Cleanse(base::Value& value);

class Secret {
 public:
  Secret();
  explicit Secret(const std::string* value);
  explicit Secret(std::string&& value);
  Secret(const Secret& other);
  Secret(Secret&& other);
  Secret& operator=(const Secret& other);
  Secret& operator=(Secret&& other);
  ~Secret();

  bool present() const { return present_; }
  const std::string& value() const { return value_; }

 private:
  std::string value_;
  bool present_ = false;
};

}

#endif
