#pragma once
#include <string>
namespace url {
struct SchemeHostPort {
  bool valid = false;
  bool IsValid() const { return valid; }
};
}
class GURL {
 public:
  GURL() = default;
  explicit GURL(const std::string& spec) {
    const size_t scheme = spec.find("://");
    if (scheme == std::string::npos || scheme == 0) return;
    const size_t rest = spec.find_first_of("/?#", scheme + 3);
    if (rest == scheme + 3) return;
    std::string origin = spec.substr(0, rest);
    for (char& c : origin) {
      if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    }
    origin_ = origin + "/";
    if (rest == std::string::npos) {
      spec_ = origin_;
    } else if (spec[rest] == '/') {
      spec_ = origin + spec.substr(rest);
    } else {
      spec_ = origin_ + spec.substr(rest);
    }
  }
  bool is_valid() const { return !spec_.empty(); }
  const std::string& spec() const { return spec_; }
  const std::string& origin() const { return origin_; }
  bool operator==(const GURL& other) const { return spec_ == other.spec_; }

 private:
  std::string spec_;
  std::string origin_;
};
