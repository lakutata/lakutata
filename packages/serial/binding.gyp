# The build of the addon of @lakutata/serial by node-gyp, when the package is installed: the settings of the line and the
# reads and writes of the ports (termios on Linux and macOS, the communications API on Windows), their listing (IOKit on
# macOS, SetupAPI on Windows; Linux lists them in JavaScript from sysfs).
{
  'targets': [
    {
      'target_name': 'serial',
      'sources': ['native/addon.cpp', 'native/Unix.cpp', 'native/Linux.cpp', 'native/Windows.cpp'],
      'include_dirs': ["<!(node -p \"require('node-addon-api').include_dir\")"],
      # A worker thread terminated while an error is thrown to it: node-addon-api would throw a C++ exception no one
      # catches (std::terminate) where the environment refuses the JavaScript one; it lets it go instead
      'defines': ['NAPI_VERSION=8', 'NAPI_CPP_EXCEPTIONS', 'NODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS', 'NODE_ADDON_API_DISABLE_DEPRECATED'],
      'cflags!': ['-fno-exceptions'],
      'cflags_cc!': ['-fno-exceptions'],
      'conditions': [
        ['OS=="mac" or OS=="ios"', {
          'xcode_settings': {
            'GCC_ENABLE_CPP_EXCEPTIONS': 'YES',
            'CLANG_CXX_LIBRARY': 'libc++'
          }
        }],
        ['OS=="mac"', {
          'xcode_settings': {'MACOSX_DEPLOYMENT_TARGET': '11.0'},
          'link_settings': {'libraries': ['-framework IOKit', '-framework CoreFoundation']}
        }],
        ['OS=="win"', {
          'defines': ['_HAS_EXCEPTIONS=1', 'NOMINMAX', 'WIN32_LEAN_AND_MEAN', 'UNICODE', '_UNICODE'],
          'msvs_settings': {
            'VCCLCompilerTool': {
              'ExceptionHandling': 1,
              'AdditionalOptions': ['/utf-8']
            }
          },
          'link_settings': {'libraries': ['setupapi.lib', 'advapi32.lib']}
        }]
      ]
    }
  ]
}
