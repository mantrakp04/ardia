#pragma once
template <typename T>
class raw_ref {
 public:
  explicit raw_ref(T& target) : target_(&target) {}
  T* operator->() const { return target_; }

 private:
  T* target_;
};
