#pragma once
#include <map>
#include <memory>
#include <string>
#include <string_view>
#include <utility>
#include <vector>
class Profile {
 public:
  bool off_the_record = false;
  bool IsOffTheRecord() const { return off_the_record; }
  std::map<const void*, std::unique_ptr<struct ProfileStateBase>> states;
};
struct ProfileStateBase {
  virtual ~ProfileStateBase() = default;
};
namespace base {
struct DictValue {
  std::map<std::string, std::string> values;
  DictValue&& Set(const char* key, const std::u16string& value) && {
    values[key] = std::string(value.begin(), value.end());
    return std::move(*this);
  }
  DictValue&& Set(const char* key, bool value) && {
    values[key] = value ? "true" : "false";
    return std::move(*this);
  }
  DictValue&& Set(const char* key, const char* value) && {
    values[key] = value;
    return std::move(*this);
  }
};
}
namespace ardia {
struct EmittedEvent {
  std::string topic;
  Profile* profile;
  std::map<std::string, std::string> values;
};
inline std::vector<EmittedEvent> emitted;
inline void Emit(std::string_view topic, Profile* profile, base::DictValue payload) {
  emitted.push_back({std::string(topic), profile, std::move(payload.values)});
}
class ProfileState : public ProfileStateBase {
 public:
  explicit ProfileState(Profile* profile) : profile_(profile) {}
  Profile* profile() const { return profile_; }
  void WillBeDestroyed() { Release(); }

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
