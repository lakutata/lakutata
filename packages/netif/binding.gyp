# The build of the addon of @lakutata/netif by node-gyp, when the package is installed: the sources common to every
# system (native/), then the ones of the system built on (native/linux, native/darwin, native/windows). C++17 with
# exceptions: the addon uses the C functions of Node-API (through node-addon-api, a dependency of the package). Linux
# needs the headers of the kernel (linux/rtnetlink.h): the linux-headers package on Alpine.
{
  'targets': [
    {
      'target_name': 'netif',
      'sources': ['native/addon.cpp', 'native/Interfaces.cpp'],
      'include_dirs': ['native', "<!(node -p \"require('node-addon-api').include_dir\")"],
      'defines': ['NAPI_VERSION=8', 'NAPI_CPP_EXCEPTIONS', 'NODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS', 'NODE_ADDON_API_DISABLE_DEPRECATED'],
      'cflags!': ['-fno-exceptions'],
      'cflags_cc!': ['-fno-exceptions', '-fno-rtti', '-std=gnu++20', '-std=gnu++17'],
      'cflags_cc': ['-std=c++17', '-fexceptions'],
      'conditions': [
        ['OS=="linux"', {
          'sources': ['native/linux/Interfaces.cpp', 'native/linux/Watcher.cpp']
        }],
        ['OS=="mac"', {
          'sources': ['native/darwin/Interfaces.cpp', 'native/darwin/Watcher.cpp'],
          'xcode_settings': {
            'GCC_ENABLE_CPP_EXCEPTIONS': 'YES',
            'CLANG_CXX_LANGUAGE_STANDARD': 'c++17',
            'CLANG_CXX_LIBRARY': 'libc++',
            'MACOSX_DEPLOYMENT_TARGET': '11.0'
          }
        }],
        ['OS=="win"', {
          'sources': ['native/windows/Interfaces.cpp', 'native/windows/Watcher.cpp'],
          'defines': ['_HAS_EXCEPTIONS=1', 'WIN32_LEAN_AND_MEAN', 'NOMINMAX', '_WIN32_WINNT=0x0A00'],
          'libraries': ['iphlpapi.lib', 'ws2_32.lib'],
          'msvs_settings': {
            'VCCLCompilerTool': {
              'ExceptionHandling': 1,
              # The Release configuration of node-gyp asks C++20: the options given last win
              'AdditionalOptions': ['/utf-8', '/std:c++17']
            }
          }
        }]
      ]
    }
  ]
}
