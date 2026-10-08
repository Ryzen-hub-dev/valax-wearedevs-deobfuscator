cmake_minimum_required(VERSION 3.16)
project(valax_native VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(valax-native src/main.cpp)

if(MSVC)
  target_compile_options(valax-native PRIVATE /W4 /permissive-)
else()
  target_compile_options(valax-native PRIVATE -Wall -Wextra -Wpedantic -Wconversion)
endif()

include(CTest)
if(BUILD_TESTING)
  add_test(NAME valax-native-self-test COMMAND valax-native --self-test)
endif()
