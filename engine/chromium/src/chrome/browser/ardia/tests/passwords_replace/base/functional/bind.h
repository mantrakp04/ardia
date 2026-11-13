#pragma once
#include <functional>
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
void InvokeBound(F& function, First&& first, Rest&&... rest) {
  if constexpr (IsWeak<std::decay_t<First>>::value) {
    if (auto* target = first.get()) (target->*function)(std::forward<Rest>(rest)...);
  } else {
    std::invoke(function, std::forward<First>(first), std::forward<Rest>(rest)...);
  }
}
template <typename F, typename... Bound>
auto BindOnce(F function, Bound... bound) {
  return [function, ... bound = std::move(bound)](auto&&... rest) mutable {
    InvokeBound(function, std::move(bound)..., std::forward<decltype(rest)>(rest)...);
  };
}
struct DoNothingCallable {
  template <typename... Args>
  void operator()(Args&&...) const {}
};
inline DoNothingCallable DoNothing() { return {}; }
}
