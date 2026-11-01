#include "ardia/linux/ac_linux_search_engine_policy.h"

#include <cassert>
#include <cstdio>
#include <string>
#include <vector>

namespace engines = ardiacore::linux_search_engines;

namespace {

engines::Request Request(std::string name, std::string keyword, std::string url) {
  return engines::Request{std::move(name), std::move(keyword), std::move(url)};
}

bool Rejected(const engines::Request& request, const std::string& fragment) {
  const auto error = engines::Validate(request);
  return error && error->find(fragment) != std::string::npos;
}

void Validation() {
  assert(!engines::Validate(Request("Google", "google.com", "https://www.google.com/search?q=%s")));
  assert(!engines::Validate(Request("Google", "", "")));
  assert(!engines::Validate(Request("Søk", "søk", "HTTP://example.no/?q=%s")));
  assert(Rejected(Request("", "k", "https://example.com/?q=%s"), "name is required"));
  assert(Rejected(Request("   ", "k", "https://example.com/?q=%s"), "name is required"));
  assert(!engines::Validate(Request(std::string(256, 'a'), "k", "https://example.com/?q=%s")));
  assert(Rejected(Request(std::string(257, 'a'), "k", "https://example.com/?q=%s"), "longer than 256"));
  std::string accented;
  for (int i = 0; i < 256; ++i) accented += "é";
  assert(!engines::Validate(Request(accented, "k", "https://example.com/?q=%s")));
  assert(Rejected(Request(accented + "é", "k", "https://example.com/?q=%s"), "name is longer"));
  assert(Rejected(Request("A", std::string(257, 'k'), "https://example.com/?q=%s"), "keyword is longer"));
  assert(Rejected(Request("A\tB", "k", "https://example.com/?q=%s"), "name contains control"));
  assert(Rejected(Request("A\x7f", "k", "https://example.com/?q=%s"), "name contains control"));
  assert(Rejected(Request("A\xc2\x85", "k", "https://example.com/?q=%s"), "name contains control"));
  assert(Rejected(Request("A", "k\n", "https://example.com/?q=%s"), "keyword contains control"));
  assert(Rejected(Request("A", "k", "https://example.com/?q=%s\r"), "URL contains control"));
  assert(Rejected(Request("A", "k", "javascript:alert(1)//%s"), "http:// or https://"));
  assert(Rejected(Request("A", "k", "file:///tmp/%s"), "http:// or https://"));
  assert(Rejected(Request("A", "k", "https:///?q=%s"), "name a host"));
  assert(Rejected(Request("A", "k", "https://example.com/?q="), "must contain %s"));
  const std::string base = "https://example.com/?q=%s&pad=";
  assert(!engines::Validate(Request("A", "k", base + std::string(2048 - base.size(), 'x'))));
  assert(Rejected(Request("A", "k", base + std::string(2049 - base.size(), 'x')), "longer than 2048"));
}

void Templates() {
  assert(engines::ChromeTemplate("https://www.google.com/search?q=%s") == "https://www.google.com/search?q={searchTerms}");
  assert(engines::ChromeTemplate("https://x.com/%s/s?q=%s&a=%25s") == "https://x.com/{searchTerms}/s?q={searchTerms}&a=%25s");
  assert(engines::ChromeTemplate("https://x.com/?q=%s&t={x}") == "https://x.com/?q={searchTerms}&t=%7Bx%7D");
  assert(engines::ChromeTemplate("https://x.com/?q=%%s") == "https://x.com/?q=%{searchTerms}");
  assert(engines::HostOf("https://User@WWW.Example.com:8080/a?b#c") == "www.example.com");
  assert(engines::HostOf("http://[::1]:80/?q=%s") == "[::1]");
  assert(engines::HostOf("https://kagi.com?q=%s") == "kagi.com");
  assert(engines::HostOf("no-scheme") == "");
}

std::vector<engines::Engine> ChromeList(bool with_owned) {
  std::vector<engines::Engine> list = {
      {"Google", "www.google.com", true, false},
      {"Bing", "www.bing.com", true, false},
      {"DuckDuckGo", "duckduckgo.com", true, false},
      {"Bookmarks", "", false, false},
      {"Perplexity Extension", "www.perplexity.ai", false, false},
  };
  if (with_owned) list.push_back({"Kagi", "kagi.com", true, true});
  return list;
}

void Decisions() {
  using engines::Step;
  const auto google = Request("google", "google.com", "https://www.google.com/search?q=%s");
  auto plan = engines::Decide(google, "www.google.com", ChromeList(false), false);
  assert(plan.step == Step::kSelectExisting && plan.engine == 0u && !plan.remove_owned);

  plan = engines::Decide(google, "www.google.com", ChromeList(true), false);
  assert(plan.step == Step::kSelectExisting && plan.engine == 0u && plan.remove_owned);

  const auto lookalike = Request("Google", "g", "https://evil.example/?q=%s");
  plan = engines::Decide(lookalike, "evil.example", ChromeList(false), false);
  assert(plan.step == Step::kAddOwned && !plan.engine);

  const auto perplexity = Request("Perplexity Extension", "p", "https://www.perplexity.ai/search?q=%s");
  plan = engines::Decide(perplexity, "www.perplexity.ai", ChromeList(true), false);
  assert(plan.step == Step::kUpdateOwned && plan.engine == 5u && !plan.remove_owned);

  const auto kagi = Request("Kagi", "kagi.com", "https://kagi.com/search?q=%s");
  plan = engines::Decide(kagi, "kagi.com", ChromeList(true), true);
  assert(plan.step == Step::kSelectOwned && plan.engine == 5u);
  plan = engines::Decide(kagi, "kagi.com", ChromeList(true), false);
  assert(plan.step == Step::kUpdateOwned && plan.engine == 5u);
  plan = engines::Decide(kagi, "kagi.com", ChromeList(false), false);
  assert(plan.step == Step::kAddOwned);

  plan = engines::Decide(Request("BING", "", ""), "", ChromeList(true), false);
  assert(plan.step == Step::kSelectExisting && plan.engine == 1u && plan.remove_owned);
  plan = engines::Decide(Request("kagi", "", ""), "", ChromeList(true), false);
  assert(plan.step == Step::kSelectOwned && plan.engine == 5u && !plan.remove_owned);
  plan = engines::Decide(Request("Bookmarks", "", ""), "", ChromeList(false), false);
  assert(plan.step == Step::kNoMatch);
  plan = engines::Decide(Request("Kagi", "", ""), "", ChromeList(false), false);
  assert(plan.step == Step::kNoMatch);

  const auto empty_host = Request("Google", "g", "https://www.google.com/?q=%s");
  plan = engines::Decide(empty_host, "", {{"Google", "", true, false}}, false);
  assert(plan.step == Step::kAddOwned);
}

}

int main() {
  Validation();
  Templates();
  Decisions();
  std::puts("search engine policy scenarios passed");
}
