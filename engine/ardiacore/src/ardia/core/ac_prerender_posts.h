#ifndef ARDIA_CORE_AC_PRERENDER_POSTS_H_
#define ARDIA_CORE_AC_PRERENDER_POSTS_H_

#include <stddef.h>

#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace ardiacore {

inline constexpr size_t kMaxPrerenderPosts = 64;
inline constexpr size_t kMaxPrerenderPostBytes = 2 * 1024 * 1024;

template <typename Document>
class PrerenderPosts {
 public:
  using Post = std::pair<std::string, std::string>;

  enum class Verdict {
    kSend,
    kHold,
    kHoldUntilActivated,
  };

  Verdict Take(const Document& document,
               bool prerendering,
               const std::string& kind,
               const std::string& json) {
    if (document_ != document) {
      Forget();
    }
    if (!document_) {
      if (!prerendering) {
        return Verdict::kSend;
      }
      document_ = document;
      Add(kind, json);
      return Verdict::kHoldUntilActivated;
    }
    Add(kind, json);
    return Verdict::kHold;
  }

  std::vector<Post> Release(const Document& document) {
    if (document_ != document) {
      return {};
    }
    std::vector<Post> posts = std::move(posts_);
    Forget();
    return posts;
  }

 private:
  void Add(const std::string& kind, const std::string& json) {
    const size_t bytes = kind.size() + json.size();
    if (posts_.size() >= kMaxPrerenderPosts ||
        bytes_ + bytes > kMaxPrerenderPostBytes) {
      return;
    }
    bytes_ += bytes;
    posts_.emplace_back(kind, json);
  }

  void Forget() {
    document_.reset();
    posts_.clear();
    bytes_ = 0;
  }

  std::optional<Document> document_;
  std::vector<Post> posts_;
  size_t bytes_ = 0;
};

}

#endif
