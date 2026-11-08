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
    const size_t path = spec.find('/', scheme + 3);
    if (path == scheme + 3) return;
    for (char c : spec.substr(0, path)) {
      if (c >= 'A' && c <= 'Z') return;
    }
    origin_ = spec.substr(0, path) + "/";
    spec_ = path == std::string::npos ? origin_ : spec;
  }
  bool is_valid() const { return !spec_.empty(); }
  const std::string& spec() const { return spec_; }
  const std::string& origin() const { return origin_; }
  bool operator==(const GURL& other) const { return spec_ == other.spec_; }

 private:
  std::string spec_;
  std::string origin_;
};
