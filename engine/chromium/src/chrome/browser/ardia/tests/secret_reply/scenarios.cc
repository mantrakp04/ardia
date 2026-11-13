#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <new>
#include <random>
#include <string>
#include <string_view>
#include <vector>

#include "base/json/json_writer.h"
#include "base/values.h"
#include "chrome/browser/ardia/ac_sensitive_args.h"

namespace {

constexpr size_t kPrefix = 16;
const char* g_needle = nullptr;
size_t g_needle_size = 0;
int g_leaks = 0;

void Scan(const unsigned char* block, size_t size) {
  if (!g_needle || size < g_needle_size) return;
  for (size_t i = 0; i + g_needle_size <= size; ++i) {
    if (std::memcmp(block + i, g_needle, g_needle_size) == 0) {
      ++g_leaks;
      return;
    }
  }
}

}

void* operator new(size_t size) {
  unsigned char* block = static_cast<unsigned char*>(std::malloc(size + kPrefix));
  if (!block) throw std::bad_alloc();
  std::memcpy(block, &size, sizeof(size));
  return block + kPrefix;
}

void operator delete(void* pointer) noexcept {
  if (!pointer) return;
  unsigned char* block = static_cast<unsigned char*>(pointer) - kPrefix;
  size_t size;
  std::memcpy(&size, block, sizeof(size));
  Scan(block + kPrefix, size);
  std::free(block);
}

void operator delete(void* pointer, size_t) noexcept {
  operator delete(pointer);
}

namespace {

int g_failures = 0;

void Expect(bool condition, const char* what) {
  if (!condition) {
    std::printf("FAIL: %s\n", what);
    ++g_failures;
  }
}

struct Seen {
  int calls = 0;
  std::string json;
};

void Capture(void* context, const char* json) {
  Seen* seen = static_cast<Seen*>(context);
  ++seen->calls;
  seen->json.assign(json);
}

struct Watch {
  Watch(const std::string& needle) {
    g_needle = needle.data();
    g_needle_size = needle.size();
    g_leaks = 0;
  }
  ~Watch() { g_needle = nullptr; }
};

std::string RunToken(size_t length, std::string_view alphabet = "abcdefghijklmnopqrstuvwxyz0123456789") {
  static std::mt19937_64 engine(std::random_device{}());
  std::string token;
  for (size_t i = 0; i < length; ++i) token.push_back(alphabet[engine() % alphabet.size()]);
  return token;
}

std::string Escaped(std::string_view secret) {
  base::DictValue dict;
  dict.Set("password", std::string(secret));
  std::string json;
  base::JSONWriter::Write(base::Value(std::move(dict)), &json);
  return json;
}

void SecretReplyIsWipedAfterTheCallback(const std::string& secret, const char* label) {
  const std::string expected = Escaped(secret);
  const std::string needle = secret.substr(0, 24);
  const std::string escaped_needle = expected.substr(1, 40);
  Seen seen;
  {
    Watch watch(needle);
    ardia::SendSecretJson(base::DictValue().Set("password", secret), &Capture, &seen);
    seen.json.clear();
    seen.json.shrink_to_fit();
    std::printf("%s: %d freed blocks held the secret\n", label, g_leaks);
    const int receiver_copies = expected.find(needle) == std::string::npos ? 0 : 1;
    Expect(g_leaks == receiver_copies, "only the receiver's own copy is freed holding the secret");
  }
  Seen again;
  {
    Watch watch(escaped_needle);
    ardia::SendSecretJson(base::DictValue().Set("password", secret), &Capture, &again);
    Expect(again.calls == 1, "the reply callback runs once");
    Expect(again.json == expected, "the callback gets the exact JSON");
    again.json.clear();
    again.json.shrink_to_fit();
    Expect(g_leaks == 1, "the serialized buffer is wiped and never reallocated");
  }
}

void PlainSerializationLeavesTheSecretBehind() {
  const std::string secret = "plain-" + RunToken(26);
  Watch watch(secret);
  {
    base::Value value(base::DictValue().Set("password", secret));
    std::string json;
    base::JSONWriter::Write(value, &json);
  }
  Expect(g_leaks >= 1, "the detector sees an unwiped serialization");
}

void NestedAndNonStringFieldsAreWiped() {
  const std::string number = "4" + RunToken(15, "0123456789");
  const std::string expected = "{\"authenticated\":true,\"number\":\"" + number + "\"}";
  Seen seen;
  Watch watch(number);
  ardia::SendSecretJson(base::DictValue().Set("number", number).Set("authenticated", true), &Capture, &seen);
  Expect(seen.json == expected, "card reply JSON");
  seen.json.clear();
  seen.json.shrink_to_fit();
  Expect(g_leaks == 1, "the card number leaves only the receiver's copy");
}

void SecretUTF8EncodesLikeChromium() {
  Expect(ardia::SecretUTF8(u"") == "", "empty");
  Expect(ardia::SecretUTF8(u"abc") == "abc", "ascii");
  Expect(ardia::SecretUTF8(u"\u00e9\u20ac") == "\xc3\xa9\xe2\x82\xac", "two and three bytes");
  Expect(ardia::SecretUTF8(u"\U0001F511") == "\xf0\x9f\x94\x91", "surrogate pair");
  const char16_t lone[] = {u'a', static_cast<char16_t>(0xD800), u'b', static_cast<char16_t>(0xDC00), 0};
  Expect(ardia::SecretUTF8(lone) == "a\xef\xbf\xbd" "b\xef\xbf\xbd", "lone surrogates become U+FFFD");
  const char16_t nonchar[] = {static_cast<char16_t>(0xFFFE), 0};
  Expect(ardia::SecretUTF8(nonchar) == "\xef\xbf\xbe", "noncharacters pass through");
}

void NonAsciiPasswordLeavesNoFreedCopy() {
  std::u16string password = u"\u00e9\u20ac\u20ac-\U0001F511-";
  for (const char c : RunToken(32)) password.push_back(static_cast<char16_t>(c));
  for (int i = 0; i < 200; ++i) password += u"\u00e9";
  std::string utf8 = ardia::SecretUTF8(password);
  const std::string needle = utf8.substr(0, 24);
  Seen seen;
  {
    Watch watch(needle);
    {
      std::string converted = ardia::SecretUTF8(password);
      Expect(converted == utf8, "conversion is stable");
      Expect(converted.capacity() >= 3 * password.size(), "the buffer is reserved up front");
      ardia::Cleanse(converted);
    }
    Expect(g_leaks == 0, "converting a non-ASCII password frees no unwiped copy");
  }
  ardia::Cleanse(utf8);
}

void NullSecretStillReplies() {
  Seen seen;
  ardia::SendSecretJson(base::DictValue().Set("password", base::Value()), &Capture, &seen);
  Expect(seen.calls == 1 && seen.json == "{\"password\":null}", "a null secret replies null");
}

}

int main() {
  PlainSerializationLeavesTheSecretBehind();
  SecretReplyIsWipedAfterTheCallback(RunToken(36), "short");
  std::string controls = "ctl-" + RunToken(13);
  for (int i = 0; i < 2000; ++i) controls.push_back(static_cast<char>(1 + i % 30));
  SecretReplyIsWipedAfterTheCallback(controls, "escaped");
  std::string quoted = "quote-" + RunToken(7) + "\"\\-";
  for (int i = 0; i < 3000; ++i) quoted.push_back(i % 2 ? '"' : '\\');
  SecretReplyIsWipedAfterTheCallback(quoted, "quoted");
  NestedAndNonStringFieldsAreWiped();
  NullSecretStillReplies();
  SecretUTF8EncodesLikeChromium();
  NonAsciiPasswordLeavesNoFreedCopy();
  if (g_failures) return 1;
  std::printf("secret reply scenarios passed\n");
  return 0;
}
