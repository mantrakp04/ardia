#pragma once
#include <cstddef>
#include <cstring>

inline void OPENSSL_cleanse(void* data, size_t size) {
  volatile unsigned char* bytes = static_cast<volatile unsigned char*>(data);
  for (size_t i = 0; i < size; ++i) bytes[i] = 0;
}
