#pragma once
#include <cassert>
#include <functional>
#include <memory>
#include <tuple>
#include <utility>

namespace base {
template<class> class OnceCallback;
template<class R, class... A> class OnceCallback<R(A...)> {
  struct Target { virtual ~Target() = default; virtual R Run(A... args) = 0; };
  template<class F> struct Callable : Target {
    F fn;
    explicit Callable(F value) : fn(std::move(value)) {}
    R Run(A... args) override { return fn(std::forward<A>(args)...); }
  };
  std::unique_ptr<Target> fn_;
 public:
  OnceCallback() = default;
  template<class F> OnceCallback(F fn) : fn_(std::make_unique<Callable<F>>(std::move(fn))) {}
  OnceCallback(OnceCallback&&) = default;
  OnceCallback& operator=(OnceCallback&&) = default;
  OnceCallback(const OnceCallback&) = delete;
  explicit operator bool() const { return !!fn_; }
  R Run(A... args) && { auto fn = std::move(fn_); assert(fn); return fn->Run(std::forward<A>(args)...); }
};
template<class> class RepeatingCallback;
template<class R, class... A> class RepeatingCallback<R(A...)> {
  std::function<R(A...)> fn_;
 public:
  RepeatingCallback() = default;
  template<class F> RepeatingCallback(F fn) : fn_(std::move(fn)) {}
  R Run(A... args) const { return fn_(std::forward<A>(args)...); }
};
template<class T> class WeakPtr {
  T* value_ = nullptr;
  std::weak_ptr<int> life_;
 public:
  WeakPtr() = default;
  WeakPtr(T* value, std::weak_ptr<int> life) : value_(value), life_(std::move(life)) {}
  T* get() const { return life_.expired() ? nullptr : value_; }
  T* operator->() const { return get(); }
  explicit operator bool() const { return get() != nullptr; }
};
template<class T> class WeakPtrFactory {
  T* value_;
  std::shared_ptr<int> life_ = std::make_shared<int>(0);
 public:
  explicit WeakPtrFactory(T* value) : value_(value) {}
  WeakPtr<T> GetWeakPtr() { return {value_, life_}; }
  void InvalidateWeakPtrs() { life_ = std::make_shared<int>(0); }
};
template<class C, class... A, class... B>
auto BindOnce(void(C::*fn)(A...), WeakPtr<C> weak, B... bound) {
  return [fn, weak, bound = std::make_tuple(std::move(bound)...)](auto... args) mutable {
    if (!weak) return;
    std::apply([&](auto&&... values) { (weak.get()->*fn)(std::move(values)..., std::move(args)...); }, std::move(bound));
  };
}
}

namespace base {
template<class F, class... B> auto BindOnce(F fn, B... bound) {
  return [fn = std::move(fn), bound = std::make_tuple(std::move(bound)...)]() mutable {
    std::apply([&](auto&&... args) { std::move(fn).Run(std::move(args)...); }, std::move(bound));
  };
}
template<class F, class... B> auto BindRepeating(F fn, B... bound) {
  return [fn, bound = std::make_tuple(std::move(bound)...)](auto&&... args) mutable -> decltype(auto) {
    return std::apply([&](auto&... values) -> decltype(auto) { return fn(values..., std::forward<decltype(args)>(args)...); }, bound);
  };
}
using OnceClosure = OnceCallback<void()>;
}
