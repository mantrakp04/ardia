#pragma once
#include <memory>
template <typename T>
using scoped_refptr = std::shared_ptr<T>;
