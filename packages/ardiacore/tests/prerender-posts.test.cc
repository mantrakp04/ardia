#include "../../../engine/ardiacore/src/ardia/core/ac_prerender_posts.h"

#include <cstdio>
#include <string>
#include <vector>

using namespace ardiacore;

static int failures = 0;
#define CHECK(cond)                                                \
  do {                                                             \
    if (!(cond)) {                                                 \
      std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);  \
      failures++;                                                  \
    }                                                              \
  } while (0)

using Posts = PrerenderPosts<std::string>;
using Verdict = Posts::Verdict;

static std::vector<std::string> Kinds(const std::vector<Posts::Post>& posts) {
  std::vector<std::string> kinds;
  for (const auto& [kind, json] : posts) {
    kinds.push_back(kind);
  }
  return kinds;
}

int main() {
  // A page that isn't prerendering posts straight away.
  {
    Posts posts;
    CHECK(posts.Take("a", false, "hello", "{}") == Verdict::kSend);
    CHECK(posts.Take("a", false, "theme", "{}") == Verdict::kSend);
    CHECK(posts.Release("a").empty());
  }

  // A prerendering page holds every post, and only the first one asks to be
  // released on activation. Release hands them back in order, once.
  {
    Posts posts;
    CHECK(posts.Take("a", true, "hello", "{\"top\":true}") == Verdict::kHoldUntilActivated);
    CHECK(posts.Take("a", true, "theme", "{}") == Verdict::kHold);
    CHECK(posts.Take("a", true, "media", "{}") == Verdict::kHold);
    const auto released = posts.Release("a");
    CHECK((Kinds(released) == std::vector<std::string>{"hello", "theme", "media"}));
    CHECK(released[0].second == "{\"top\":true}");
    CHECK(posts.Release("a").empty());
    CHECK(posts.Take("a", false, "theme", "{}") == Verdict::kSend);
  }

  // The page's own prerenderingchange handler posts after the document stops
  // prerendering and before Release runs: that post still goes out last.
  {
    Posts posts;
    CHECK(posts.Take("a", true, "hello", "{}") == Verdict::kHoldUntilActivated);
    CHECK(posts.Take("a", false, "theme", "{}") == Verdict::kHold);
    CHECK((Kinds(posts.Release("a")) == std::vector<std::string>{"hello", "theme"}));
    CHECK(posts.Take("a", false, "theme", "{}") == Verdict::kSend);
  }

  // A frame that loads another document drops what the old one held, and the
  // old document's activation can no longer release anything.
  {
    Posts posts;
    CHECK(posts.Take("a", true, "hello", "{}") == Verdict::kHoldUntilActivated);
    CHECK(posts.Take("b", true, "hello", "{}") == Verdict::kHoldUntilActivated);
    CHECK(posts.Release("a").empty());
    CHECK((Kinds(posts.Release("b")) == std::vector<std::string>{"hello"}));
  }
  {
    Posts posts;
    CHECK(posts.Take("a", true, "hello", "{}") == Verdict::kHoldUntilActivated);
    CHECK(posts.Take("b", false, "hello", "{}") == Verdict::kSend);
    CHECK(posts.Release("a").empty());
  }

  // A page that talks a lot while it waits keeps its first posts, up to a
  // count and a size.
  {
    Posts posts;
    CHECK(posts.Take("a", true, "first", "{}") == Verdict::kHoldUntilActivated);
    for (size_t i = 1; i < kMaxPrerenderPosts + 20; i++) {
      CHECK(posts.Take("a", true, "more", "{}") == Verdict::kHold);
    }
    const auto released = posts.Release("a");
    CHECK(released.size() == kMaxPrerenderPosts);
    CHECK(released.front().first == "first");
  }
  {
    Posts posts;
    const std::string big(kMaxPrerenderPostBytes / 2, 'x');
    CHECK(posts.Take("a", true, "one", big) == Verdict::kHoldUntilActivated);
    CHECK(posts.Take("a", true, "two", big) == Verdict::kHold);
    CHECK(posts.Take("a", true, "three", "{}") == Verdict::kHold);
    CHECK((Kinds(posts.Release("a")) == std::vector<std::string>{"one", "three"}));
  }

  if (failures) {
    std::printf("%d failure(s)\n", failures);
    return 1;
  }
  std::printf("prerender posts ok\n");
  return 0;
}
