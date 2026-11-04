# The build of the addon of @lakutata/mongo-embedded by node-gyp, when the package is installed: the thread of each
# database and the functions of the addon (native/), in C++17 through node-addon-api (the C functions of Node-API).
{
  'targets': [
    {
      'target_name': 'mongo_embedded',
      'sources': ['native/addon.cc', 'native/database.cc'],
      'include_dirs': ['native', "<!(node -p \"require('node-addon-api').include_dir\")"],
      'defines': ['NAPI_VERSION=8', 'NAPI_CPP_EXCEPTIONS', 'NODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS', 'NODE_ADDON_API_DISABLE_DEPRECATED'],
      'cflags!': ['-fno-exceptions'],
      'cflags_cc!': ['-fno-exceptions', '-fno-rtti', '-std=gnu++20', '-std=gnu++17'],
      'cflags_cc': ['-std=c++17', '-fexceptions'],
      'conditions': [
        ['OS=="mac"', {
          'xcode_settings': {
            'GCC_ENABLE_CPP_EXCEPTIONS': 'YES',
            'CLANG_CXX_LANGUAGE_STANDARD': 'c++17',
            'CLANG_CXX_LIBRARY': 'libc++',
            'MACOSX_DEPLOYMENT_TARGET': '11.0'
          }
        }],
        ['OS=="win"', {
          'defines': ['_HAS_EXCEPTIONS=1'],
          'msvs_settings': {
            'VCCLCompilerTool': {
              'ExceptionHandling': 1,
              'AdditionalOptions': ['/utf-8', '/std:c++17']
            }
          }
        }]
      ]
    }
  ]
}
