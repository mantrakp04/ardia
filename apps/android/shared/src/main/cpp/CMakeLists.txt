cmake_minimum_required(VERSION 3.22.1)
project(ardiahermes CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(hermes-engine REQUIRED CONFIG)
find_package(fbjni REQUIRED CONFIG)

add_library(jsi SHARED IMPORTED)
set_target_properties(jsi PROPERTIES
    IMPORTED_LOCATION ${JSI_ROOT}/libs/${ANDROID_ABI}/libjsi.so
    INTERFACE_INCLUDE_DIRECTORIES ${JSI_ROOT}/headers/include)

add_library(ardiahermes SHARED ardia_hermes.cpp)
target_compile_options(ardiahermes PRIVATE -fexceptions -frtti -Wall -Werror)
target_link_libraries(ardiahermes hermes-engine::hermesvm fbjni::fbjni jsi log)
