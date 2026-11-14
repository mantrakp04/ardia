cmake_minimum_required(VERSION 3.22.1)
project(ardiahermes CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(hermes-engine REQUIRED CONFIG)
find_package(fbjni REQUIRED CONFIG)
find_package(ReactAndroid REQUIRED CONFIG)

add_library(ardiahermes SHARED ${ARDIA_SCRIPT_SHIM})
target_compile_definitions(ardiahermes PRIVATE ARDIA_REACT_NATIVE_HERMES)
target_compile_options(ardiahermes PRIVATE -fexceptions -frtti -Wall -Werror)
target_link_libraries(ardiahermes hermes-engine::libhermes ReactAndroid::jsi fbjni::fbjni log)
