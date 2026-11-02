# The build of the addon of @lakutata/barcode by node-gyp, when the package is installed: zint, zxing-cpp (its readers),
# wuffs and stb_image_write compiled from their vendored sources (vendor/, scripts/sync.mjs) as static libraries, then
# the addon (native/) linked with them. The lists of sources come from scripts/sources.mjs. C++20 for zxing-cpp and the
# addon (C++17 for the public API of zxing-cpp, C++20 inside); zint and stb_image_write are C.
{
  'targets': [
    {
      # The settings of C++ of every target, given by depending on this one (as node-addon-api gives its exceptions): the
      # settings of a dependency are merged after the ones of node-gyp (no exceptions, no RTTI), which they replace
      'target_name': 'cxx',
      'type': 'none',
      'direct_dependent_settings': {
        'cflags!': ['-fno-exceptions'],
        'cflags_cc!': ['-fno-exceptions', '-fno-rtti', '-std=gnu++20', '-std=gnu++17'],
        'cflags_cc': ['-std=c++20', '-fexceptions', '-frtti'],
        'conditions': [
          # iOS: its libnode is configured with OS "ios", whose settings of Xcode (in the common.gypi of Node.js) turn the
          # exceptions and RTTI off as the ones of macOS do
          ['OS=="mac" or OS=="ios"', {
            'xcode_settings': {
              'GCC_ENABLE_CPP_EXCEPTIONS': 'YES',
              'GCC_ENABLE_CPP_RTTI': 'YES',
              'CLANG_CXX_LANGUAGE_STANDARD': 'c++20',
              'CLANG_CXX_LIBRARY': 'libc++'
            }
          }],
          ['OS=="mac"', {
            'xcode_settings': {'MACOSX_DEPLOYMENT_TARGET': '11.0'}
          }],
          ['OS=="win"', {
            'defines': ['_HAS_EXCEPTIONS=1', 'NOMINMAX', '_CRT_SECURE_NO_WARNINGS', '_SCL_SECURE_NO_WARNINGS', '_CRT_NONSTDC_NO_WARNINGS'],
            'msvs_settings': {
              'VCCLCompilerTool': {
                'ExceptionHandling': 1,
                'RuntimeTypeInfo': 'true',
                'LanguageStandard': 'stdcpp20',
                # The Release configuration of node-gyp turns RTTI off: the options given last win
                'AdditionalOptions': ['/bigobj', '/utf-8', '/GR', '/std:c++20']
              }
            }
          }],
          # HarmonyOS: the libc++ 15 of DevEco Studio gives <format> and <ranges> to -fexperimental-library only
          ['OS=="openharmony"', {
            'cflags_cc': ['-fexperimental-library'],
            'ldflags': ['-fexperimental-library']
          }]
        ]
      }
    },
    {
      # zint: its encoding library, without libpng (ZINT_NO_PNG: the PNG is written by stb_image_write)
      'target_name': 'zint',
      'type': 'static_library',
      'dependencies': ['cxx'],
      'sources': ['<!@(node scripts/sources.mjs zint)'],
      'include_dirs': ['vendor/zint/backend'],
      'defines': ['ZINT_NO_PNG'],
      'cflags': ['-w'],
      'xcode_settings': {'WARNING_CFLAGS': ['-w']},
      'msvs_settings': {'VCCLCompilerTool': {'WarningLevel': 0}},
      'conditions': [
        ['OS=="win"', {'defines': ['_CRT_SECURE_NO_WARNINGS']}],
        ['OS!="win" and OS!="mac" and OS!="ios"', {'link_settings': {'libraries': ['-lm']}}]
      ],
      'direct_dependent_settings': {'include_dirs': ['vendor/zint/backend']}
    },
    {
      # The character sets of zxing-cpp (C): to UTF-8 only, its readers do not write ECI
      'target_name': 'zueci',
      'type': 'static_library',
      'dependencies': ['cxx'],
      'sources': ['<!@(node scripts/sources.mjs zueci)'],
      'include_dirs': ['vendor/zxing-cpp/core/src/libzueci'],
      'defines': ['ZUECI_EMBED_NO_TO_ECI'],
      'cflags': ['-w'],
      'xcode_settings': {'WARNING_CFLAGS': ['-w']},
      'msvs_settings': {'VCCLCompilerTool': {'WarningLevel': 0}}
    },
    {
      # zxing-cpp: its readers (ZXING_READERS in native/config/zxing/Version.h, written by scripts/sync.mjs)
      'target_name': 'zxing',
      'type': 'static_library',
      'dependencies': ['cxx'],
      'sources': ['<!@(node scripts/sources.mjs zxing)'],
      'include_dirs': ['native/config/zxing', 'vendor/zxing-cpp/core/src'],
      'defines': ['ZXING_INTERNAL'],
      'cflags_cc': ['-w'],
      'xcode_settings': {'WARNING_CFLAGS': ['-w']},
      'msvs_settings': {'VCCLCompilerTool': {'WarningLevel': 0}},
      'direct_dependent_settings': {'include_dirs': ['native/config/zxing', 'vendor/zxing-cpp/core/src']}
    },
    {
      # wuffs (its C++ API: the file compiled as C++) and stb_image_write
      'target_name': 'codecs',
      'type': 'static_library',
      'dependencies': ['cxx'],
      'sources': ['<!@(node scripts/sources.mjs codecs)'],
      'include_dirs': ['native', 'vendor/wuffs/release/c', 'vendor/stb'],
      'cflags': ['-w'],
      'cflags_cc': ['-w'],
      'xcode_settings': {'WARNING_CFLAGS': ['-w']},
      'msvs_settings': {'VCCLCompilerTool': {'WarningLevel': 0}},
      'direct_dependent_settings': {'include_dirs': ['vendor/wuffs/release/c', 'vendor/stb']}
    },
    {
      'target_name': 'barcode',
      'sources': ['<!@(node scripts/sources.mjs barcode)'],
      'dependencies': ['cxx', 'zint', 'zueci', 'zxing', 'codecs'],
      'include_dirs': ['native', "<!(node -p \"require('node-addon-api').include_dir\")"],
      # A worker thread terminated while an error is thrown to it: node-addon-api would throw a C++ exception no one
      # catches (std::terminate) where the environment refuses the JavaScript one; it lets it go instead
      'defines': ['NAPI_VERSION=8', 'NAPI_CPP_EXCEPTIONS', 'NODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS', 'NODE_ADDON_API_DISABLE_DEPRECATED']
    }
  ]
}
