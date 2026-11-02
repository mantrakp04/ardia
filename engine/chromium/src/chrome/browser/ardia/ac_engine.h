// Copyright 2026 Ardia. Apache-2.0.

#ifndef CHROME_BROWSER_ARDIA_AC_ENGINE_H_
#define CHROME_BROWSER_ARDIA_AC_ENGINE_H_

#include <cstddef>
#include <limits>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

#include "base/memory/raw_ptr.h"
#include "base/scoped_observation.h"
#include "base/supports_user_data.h"
#include "base/time/time.h"
#include "base/values.h"
#include "chrome/browser/ardia/ac_sensitive_args.h"
#include "chrome/browser/ardia/public/ac_engine.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_observer.h"

#define AC_ENGINE_CALL(name)                                            \
  extern "C" AC_ENGINE_EXPORT void name(                                \
      const char* profile_dir, const char* args_json,                   \
      ac_engine_reply_t reply, void* context)

#define AC_PROFILE_CALL(name, ...)                                      \
  static void name##_Run(ardia::Call& call);                            \
  AC_ENGINE_CALL(name) {                                                \
    ardia::Call call(profile_dir, args_json, reply,                     \
                     context __VA_OPT__(, ) __VA_ARGS__);               \
    if (call) {                                                         \
      name##_Run(call);                                                 \
    }                                                                   \
  }                                                                     \
  static void name##_Run(ardia::Call& call)

#define AC_ARGS_CALL(name)                                              \
  static void name##_Run(ardia::ArgsCall& call);                        \
  AC_ENGINE_CALL(name) {                                                \
    ardia::ArgsCall call(args_json, reply, context);                    \
    if (call) {                                                         \
      name##_Run(call);                                                 \
    }                                                                   \
  }                                                                     \
  static void name##_Run(ardia::ArgsCall& call)

namespace content {
class WebContents;
}

namespace ardia {

class Reply {
 public:
  Reply(ac_engine_reply_t reply, void* context);
  Reply(Reply&& other);
  Reply& operator=(Reply&& other);
  Reply(const Reply&) = delete;
  Reply& operator=(const Reply&) = delete;
  ~Reply();

  void Send(base::DictValue result);
  void SendSecretJSON(std::string& json);
  void Ok();
  void Error(std::string_view message);

 private:
  ac_engine_reply_t reply_;
  void* context_;
};

enum class OffTheRecord { kRefuse, kAllow };

struct Sensitive {
  size_t max_bytes;
};

inline constexpr size_t kNoArgsLimit = std::numeric_limits<size_t>::max();

inline constexpr int kSettleChecks = 20;
inline constexpr base::TimeDelta kSettleStep = base::Milliseconds(50);

class ArgsCall {
 public:
  ArgsCall(const char* args_json,
           ac_engine_reply_t reply,
           void* context,
           size_t max_bytes = kNoArgsLimit,
           OffTheRecord off_the_record = OffTheRecord::kRefuse);
  ArgsCall(const ArgsCall&) = delete;
  ArgsCall& operator=(const ArgsCall&) = delete;
  ~ArgsCall();

  explicit operator bool() const { return parsed_; }
  bool off_the_record() const { return off_the_record_; }
  const base::DictValue& args() const { return args_; }
  std::string String(std::string_view key) const;
  bool Bool(std::string_view key, bool fallback = false) const;
  double Double(std::string_view key, double fallback = 0) const;
  std::optional<Secret> SecretAt(std::string_view key) const;

  Reply TakeReply() { return std::move(reply_); }

 private:
  base::DictValue args_;
  Reply reply_;
  bool parsed_ = false;
  bool off_the_record_ = false;
};

class Call : public ArgsCall {
 public:
  Call(const char* profile_dir,
       const char* args_json,
       ac_engine_reply_t reply,
       void* context,
       OffTheRecord off_the_record = OffTheRecord::kRefuse);
  Call(const char* profile_dir,
       const char* args_json,
       ac_engine_reply_t reply,
       void* context,
       Sensitive sensitive);
  ~Call();

  explicit operator bool() const { return profile_ != nullptr; }
  Profile* profile() const { return profile_; }

 private:
  Call(const char* profile_dir,
       const char* args_json,
       ac_engine_reply_t reply,
       void* context,
       size_t max_bytes,
       OffTheRecord off_the_record);

  Profile* profile_ = nullptr;
};

Profile* ProfileAt(std::string_view dir);

content::WebContents* TabWithId(int id);

class ProfileState : public base::SupportsUserData::Data,
                     public ProfileObserver {
 public:
  explicit ProfileState(Profile* profile);
  ~ProfileState() override;

  Profile* profile() const { return profile_; }

 protected:
  virtual void Release() {}

 private:
  void OnProfileWillBeDestroyed(Profile* profile) override;

  raw_ptr<Profile> profile_;
  base::ScopedObservation<Profile, ProfileObserver> observation_{this};
};

template <typename T>
T& StateFor(Profile* profile) {
  static const int kKey = 0;
  auto* state = static_cast<T*>(profile->GetUserData(&kKey));
  if (!state) {
    auto owned = std::make_unique<T>(profile);
    state = owned.get();
    profile->SetUserData(&kKey, std::move(owned));
  }
  return *state;
}

void Emit(std::string_view topic, Profile* profile, base::DictValue payload);

}

#endif
