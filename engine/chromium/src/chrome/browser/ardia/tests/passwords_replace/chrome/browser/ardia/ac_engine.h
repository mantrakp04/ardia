#pragma once
#include <cstddef>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include "base/time/time.h"
namespace password_manager {
class PasswordStoreInterface;
}
class Profile {
 public:
  std::shared_ptr<password_manager::PasswordStoreInterface> profile_store;
  std::shared_ptr<password_manager::PasswordStoreInterface> account_store;
  std::map<const void*, std::unique_ptr<struct ProfileStateBase>> states;
};
struct ProfileStateBase {
  virtual ~ProfileStateBase() = default;
  virtual void WillBeDestroyed() = 0;
};
namespace ardia {
inline void Cleanse(std::u16string& text) {
  text.assign(text.capacity(), u'\0');
  text.clear();
}
class Secret {
 public:
  explicit Secret(std::string value) : value_(std::move(value)) {}
  const std::string& value() const { return value_; }

 private:
  std::string value_;
};
struct Sensitive {
  size_t max_bytes;
};
inline constexpr int kSettleChecks = 20;
inline constexpr base::TimeDelta kSettleStep = base::Milliseconds(50);
struct Outcome {
  int replies = 0;
  bool ok = false;
  std::string error;
};
class Reply {
 public:
  explicit Reply(Outcome* outcome) : outcome_(outcome) {}
  Reply(Reply&& other) : outcome_(std::exchange(other.outcome_, nullptr)) {}
  Reply& operator=(Reply&& other) {
    outcome_ = std::exchange(other.outcome_, nullptr);
    return *this;
  }
  ~Reply() {
    if (outcome_) Error("no reply");
  }
  void Ok() { Answer(true, {}); }
  void Error(std::string_view message) { Answer(false, message); }

 private:
  void Answer(bool ok, std::string_view error) {
    if (!outcome_) return;
    ++outcome_->replies;
    outcome_->ok = ok;
    outcome_->error = std::string(error);
    outcome_ = nullptr;
  }
  Outcome* outcome_;
};
class Call {
 public:
  Call(Profile* profile, std::map<std::string, std::string> strings, std::optional<std::string> password,
       Outcome* outcome)
      : profile_(profile), strings_(std::move(strings)), password_(std::move(password)), reply_(outcome) {}
  Profile* profile() const { return profile_; }
  std::string String(std::string_view key) const {
    auto found = strings_.find(std::string(key));
    return found == strings_.end() ? std::string() : found->second;
  }
  std::optional<Secret> SecretAt(std::string_view key) const {
    return key == "password" && password_ ? std::optional<Secret>(Secret(*password_)) : std::nullopt;
  }
  Reply TakeReply() { return std::move(reply_); }

 private:
  Profile* profile_;
  std::map<std::string, std::string> strings_;
  std::optional<std::string> password_;
  Reply reply_;
};
class ProfileState : public ProfileStateBase {
 public:
  explicit ProfileState(Profile* profile) : profile_(profile) {}
  Profile* profile() const { return profile_; }
  void WillBeDestroyed() override { Release(); }

 protected:
  virtual void Release() {}

 private:
  Profile* profile_;
};
template <typename T>
T& StateFor(Profile* profile) {
  static const int kKey = 0;
  auto& slot = profile->states[&kKey];
  if (!slot) slot = std::make_unique<T>(profile);
  return static_cast<T&>(*slot);
}
}
#define AC_PROFILE_CALL(name, ...)                         \
  extern const ardia::Sensitive name##_sensitive;          \
  const ardia::Sensitive name##_sensitive = __VA_ARGS__;   \
  void name(ardia::Call& call)
