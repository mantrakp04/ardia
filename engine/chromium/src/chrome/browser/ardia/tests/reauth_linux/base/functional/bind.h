#pragma once
#include <functional>
#include <tuple>
#include <type_traits>
#include <utility>
#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"
namespace base {
template <typename T>
struct IsWeak : std::false_type {};
template <typename T>
struct IsWeak<WeakPtr<T>> : std::true_type {};
template <typename F, typename First, typename... Rest>
decltype(auto) InvokeBound(F& function, First&& first, Rest&&... rest) {
  if constexpr (IsWeak<std::decay_t<First>>::value) {
    auto* target = first.get();
    if (target) (target->*function)(std::forward<Rest>(rest)...);
  } else {
    return std::invoke(function, std::forward<First>(first), std::forward<Rest>(rest)...);
  }
}
template <typename F>
decltype(auto) InvokeBound(F& function) {
  return std::invoke(function);
}
template <typename F, typename... Bound>
auto BindOnce(F function, Bound... bound) {
  return [function, ... bound = std::move(bound)](auto&&... rest) mutable -> decltype(auto) {
    return InvokeBound(function, std::move(bound)..., std::forward<decltype(rest)>(rest)...);
  };
}
struct DoNothingCallable {
  template <typename... Args>
  void operator()(Args&&...) const {}
};
inline DoNothingCallable DoNothing() { return {}; }
}
