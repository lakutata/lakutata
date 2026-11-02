cmake_minimum_required(VERSION 3.11)
project(rnapp)

set(RNOH_APP_DIR "${CMAKE_CURRENT_SOURCE_DIR}")
set(NODE_MODULES "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../node_modules")
set(RNOH_CPP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../../oh_modules/@rnoh/react-native-openharmony/src/main/cpp")
set(RNOH_GENERATED_DIR "${CMAKE_CURRENT_SOURCE_DIR}/generated")
set(LOG_VERBOSITY_LEVEL 1)
set(CMAKE_ASM_FLAGS "-Wno-error=unused-command-line-argument -Qunused-arguments")
set(CMAKE_CXX_FLAGS "-fstack-protector-strong -Wl,-z,relro,-z,now,-z,noexecstack -s -fPIE -pie")
set(WITH_HITRACE_SYSTRACE ON)
set(WITH_HITRACE_REACT_MARKER ON)
set(OH_MODULES_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../../oh_modules") # required by 'autolink_libraries'

add_subdirectory("${RNOH_CPP_DIR}" ./rn)

include("${CMAKE_CURRENT_SOURCE_DIR}/autolinking.cmake")

file(GLOB GENERATED_CPP_FILES "${CMAKE_CURRENT_SOURCE_DIR}/generated/*.cpp") # this line is needed by codegen v1

# The Node.js of the application: its host and its TurboModule (native/, shared with Android and iOS)
set(LAKUTATA_NATIVE "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../native")
set(LAKUTATA_NODE "${LAKUTATA_NATIVE}/node/out/harmony")
if(NOT EXISTS "${LAKUTATA_NODE}/libs/arm64-v8a/libnode.so")
  message(FATAL_ERROR "The libnode of HarmonyOS is missing: npm run node:harmony")
endif()
add_library(rnoh_app SHARED
    ${GENERATED_CPP_FILES}
    "./PackageProvider.cpp"
    "${RNOH_CPP_DIR}/RNOHAppNapiBridge.cpp"
    "${LAKUTATA_NATIVE}/NodeHost.cpp"
    "${LAKUTATA_NATIVE}/NodeHostTurboModule.cpp"
)
target_include_directories(rnoh_app PUBLIC "${LAKUTATA_NATIVE}")
target_link_libraries(rnoh_app PUBLIC rnoh)

autolink_libraries(rnoh_app)

# The runtime of Node.js (its embedding API) linking the libnode of HarmonyOS downloaded into native/node/out/harmony
# (npm run node:harmony, which puts libnode.so into the libraries of the HAP too); loaded by the host with dlopen
# (RTLD_LOCAL)
add_library(lakutata_node SHARED "${LAKUTATA_NATIVE}/NodeRuntime.cpp")
target_include_directories(lakutata_node PRIVATE "${LAKUTATA_NODE}/include/node")
set_target_properties(lakutata_node PROPERTIES CXX_STANDARD 20)
add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES IMPORTED_LOCATION "${LAKUTATA_NODE}/libs/arm64-v8a/libnode.so")
target_link_libraries(lakutata_node PRIVATE node)
