cmake_minimum_required(VERSION 3.13)
project(appmodules)

include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)

# The Node.js of the application: its host and its TurboModule (packages/ipc/native, shared with iOS and HarmonyOS),
# linking the libnode of Android downloaded into packages/ipc/native/node/out/android (npm run node:android)
set(LAKUTATA_NATIVE ${CMAKE_CURRENT_SOURCE_DIR}/../../../../../packages/ipc/native)
set(LAKUTATA_NODE ${LAKUTATA_NATIVE}/node/out/android)
if(NOT EXISTS ${LAKUTATA_NODE}/libs/${ANDROID_ABI}/libnode.so)
  message(FATAL_ERROR "The libnode of Android for ${ANDROID_ABI} is missing: npm run node:android")
endif()
target_sources(${CMAKE_PROJECT_NAME} PRIVATE ${LAKUTATA_NATIVE}/NodeHost.cpp ${LAKUTATA_NATIVE}/NodeHostTurboModule.cpp ${LAKUTATA_NATIVE}/NodeRuntime.cpp)
# The headers of Node.js (its embedding API) for the runtime only
set_source_files_properties(${LAKUTATA_NATIVE}/NodeRuntime.cpp PROPERTIES INCLUDE_DIRECTORIES ${LAKUTATA_NODE}/include/node)
target_include_directories(${CMAKE_PROJECT_NAME} PUBLIC ${LAKUTATA_NATIVE})
add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES IMPORTED_LOCATION ${LAKUTATA_NODE}/libs/${ANDROID_ABI}/libnode.so)
target_link_libraries(${CMAKE_PROJECT_NAME} node)
