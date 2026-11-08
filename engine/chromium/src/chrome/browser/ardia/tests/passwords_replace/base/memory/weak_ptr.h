#pragma once
#include <memory>
#include <type_traits>
#include <utility>
namespace base {
template <typename T>
class WeakPtr {
 public:
  WeakPtr() = default;
  WeakPtr(T* target, std::shared_ptr<bool> alive) : target_(target), alive_(std::move(alive)) {}
  template <typename U, typename = std::enable_if_t<std::is_convertible_v<U*, T*>>>
  WeakPtr(const WeakPtr<U>& other) : target_(other.target_), alive_(other.alive_) {}
  T* get() const { return alive_ && *alive_ ? target_ : nullptr; }
  T* operator->() const { return get(); }
  explicit operator bool() const { return get() != nullptr; }

 private:
  template <typename U>
  friend class WeakPtr;
  T* target_ = nullptr;
  std::shared_ptr<bool> alive_;
};
template <typename T>
class WeakPtrFactory {
 public:
  explicit WeakPtrFactory(T* target) : target_(target) {}
  ~WeakPtrFactory() { *alive_ = false; }
  WeakPtr<T> GetWeakPtr() { return WeakPtr<T>(target_, alive_); }
  void InvalidateWeakPtrs() {
    *alive_ = false;
    alive_ = std::make_shared<bool>(true);
  }

 private:
  T* target_;
  std::shared_ptr<bool> alive_ = std::make_shared<bool>(true);
};
}
