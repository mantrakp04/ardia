#pragma once
#include <utility>
#include <variant>
namespace base {
template <typename E>
struct unexpected {
  E error;
};
template <typename T, typename E>
class expected {
 public:
  expected(T value) : value_(std::in_place_index<0>, std::move(value)) {}
  expected(unexpected<E> error) : value_(std::in_place_index<1>, std::move(error.error)) {}
  bool has_value() const { return value_.index() == 0; }
  T& operator*() { return std::get<0>(value_); }

 private:
  std::variant<T, E> value_;
};
}
