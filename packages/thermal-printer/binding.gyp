# The build of the addon of @lakutata/thermal-printer by node-gyp, when the package is installed: the USB printers of
# macOS (IOKit, the user client of their printer interface) and of Windows (their usbprint interface), and the spooler
# of Windows (raw documents). Linux and the mobile systems have none: their printers are device files and CUPS commands,
# so nothing is compiled there.
{
  'targets': [
    {
      'target_name': 'thermal_printer',
      'conditions': [
        ['OS=="mac" or OS=="win"', {
          'sources': ['native/addon.cpp', 'native/Mac.cpp', 'native/Windows.cpp'],
          'include_dirs': ["<!(node -p \"require('node-addon-api').include_dir\")"],
          # A worker thread terminated while an error is thrown to it: node-addon-api would throw a C++ exception no one
          # catches (std::terminate) where the environment refuses the JavaScript one; it lets it go instead
          'defines': ['NAPI_VERSION=8', 'NAPI_CPP_EXCEPTIONS', 'NODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS', 'NODE_ADDON_API_DISABLE_DEPRECATED'],
          'cflags!': ['-fno-exceptions'],
          'cflags_cc!': ['-fno-exceptions']
        }, {
          'type': 'none'
        }],
        ['OS=="mac"', {
          'xcode_settings': {
            'GCC_ENABLE_CPP_EXCEPTIONS': 'YES',
            'CLANG_CXX_LIBRARY': 'libc++',
            'MACOSX_DEPLOYMENT_TARGET': '11.0'
          },
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
          'link_settings': {'libraries': ['setupapi.lib', 'cfgmgr32.lib', 'winspool.lib', 'advapi32.lib']}
        }]
      ]
    }
  ]
}
