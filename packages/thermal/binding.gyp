# The build of the addon of @lakutata/thermal by node-gyp, when the package is installed: FreeType (the modules of
# native/config/ftmodule.h), litehtml and its bundled gumbo, plutovg, lunasvg and libunibreak compiled from their vendored
# sources (vendor/, scripts/sync.mjs) as static libraries, then the addon (native/) linked with them. The lists of
# sources come from scripts/sources.mjs. C++17 for litehtml, lunasvg and the addon; FreeType, gumbo, plutovg and
# libunibreak are C.
{
  'targets': [
    {
      # The settings of C++ of every target, given by depending on this one (as node-addon-api gives its exceptions): the
      # settings of a dependency are merged after the ones of node-gyp (no exceptions, no RTTI), which they replace;
      # litehtml casts its elements with dynamic_cast and lunasvg throws
      'target_name': 'cxx',
      'type': 'none',
      'direct_dependent_settings': {
        'cflags!': ['-fno-exceptions'],
        'cflags_cc!': ['-fno-exceptions', '-fno-rtti', '-std=gnu++20', '-std=gnu++17'],
        'cflags_cc': ['-std=c++17', '-fexceptions', '-frtti'],
        'conditions': [
          # iOS: its libnode is configured with OS "ios", whose settings of Xcode (in the common.gypi of Node.js) turn the
          # exceptions and RTTI off as the ones of macOS do
          ['OS=="mac" or OS=="ios"', {
            'xcode_settings': {
              'GCC_ENABLE_CPP_EXCEPTIONS': 'YES',
              'GCC_ENABLE_CPP_RTTI': 'YES',
              'CLANG_CXX_LANGUAGE_STANDARD': 'c++17',
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
                'LanguageStandard': 'stdcpp17',
                # The Release configuration of node-gyp turns RTTI off: the options given last win. litehtml's sources
                # hold UTF-8 literals
                'AdditionalOptions': ['/bigobj', '/utf-8', '/GR', '/std:c++17']
              }
            }
          }]
        ]
      }
    },
    {
      # FreeType: the modules of native/config/ftmodule.h (FT_CONFIG_MODULES_H)
      'target_name': 'freetype',
      'type': 'static_library',
      'dependencies': ['cxx'],
      'sources': ['<!@(node scripts/sources.mjs freetype)'],
      'include_dirs': ['native/config', 'vendor/freetype/include'],
      'defines': ['FT2_BUILD_LIBRARY', 'FT_CONFIG_MODULES_H="ftmodule.h"'],
      'cflags': ['-w'],
      'xcode_settings': {'WARNING_CFLAGS': ['-w']},
      'msvs_settings': {'VCCLCompilerTool': {'WarningLevel': 0}},
      'direct_dependent_settings': {'include_dirs': ['vendor/freetype/include']}
    },
    {
      # gumbo: the HTML parser litehtml bundles (C99); under MSVC its strings.h (strcasecmp)
      'target_name': 'gumbo',
      'type': 'static_library',
      'dependencies': ['cxx'],
      'sources': ['<!@(node scripts/sources.mjs gumbo)'],
      'include_dirs': ['vendor/litehtml/src/gumbo/include', 'vendor/litehtml/src/gumbo/include/gumbo'],
      'cflags': ['-w', '-std=c99'],
      'xcode_settings': {'WARNING_CFLAGS': ['-w'], 'GCC_C_LANGUAGE_STANDARD': 'c99'},
      'msvs_settings': {'VCCLCompilerTool': {'WarningLevel': 0}},
      'conditions': [
        ['OS=="win"', {'include_dirs': ['vendor/litehtml/src/gumbo/visualc/include']}]
      ],
      'direct_dependent_settings': {'include_dirs': ['vendor/litehtml/src/gumbo/include']}
    },
    {
      # litehtml: the layout of HTML and CSS
      'target_name': 'litehtml',
      'type': 'static_library',
      'dependencies': ['cxx', 'gumbo'],
      'sources': ['<!@(node scripts/sources.mjs litehtml)'],
      'include_dirs': ['vendor/litehtml/include', 'vendor/litehtml/include/litehtml', 'vendor/litehtml/src'],
      'cflags_cc': ['-w'],
      'xcode_settings': {'WARNING_CFLAGS': ['-w']},
      'msvs_settings': {'VCCLCompilerTool': {'WarningLevel': 0}},
      'direct_dependent_settings': {'include_dirs': ['vendor/litehtml/include']}
    },
    {
      # plutovg: the vector graphics (fills, strokes, gradients, images) and its image decoding (stb_image)
      'target_name': 'plutovg',
      'type': 'static_library',
      'dependencies': ['cxx'],
      'sources': ['<!@(node scripts/sources.mjs plutovg)'],
      'include_dirs': ['vendor/plutovg/include'],
      'defines': ['PLUTOVG_BUILD', 'PLUTOVG_BUILD_STATIC'],
      'cflags': ['-w'],
      'xcode_settings': {'WARNING_CFLAGS': ['-w']},
      'msvs_settings': {'VCCLCompilerTool': {'WarningLevel': 0}},
      'conditions': [
        ['OS!="win" and OS!="mac" and OS!="ios"', {'link_settings': {'libraries': ['-lm']}}]
      ],
      'direct_dependent_settings': {'include_dirs': ['vendor/plutovg/include'], 'defines': ['PLUTOVG_BUILD_STATIC']}
    },
    {
      # lunasvg: SVG on plutovg
      'target_name': 'lunasvg',
      'type': 'static_library',
      'dependencies': ['cxx', 'plutovg'],
      'sources': ['<!@(node scripts/sources.mjs lunasvg)'],
      'include_dirs': ['vendor/lunasvg/include', 'vendor/plutovg/include'],
      'defines': ['LUNASVG_BUILD', 'LUNASVG_BUILD_STATIC'],
      'cflags_cc': ['-w'],
      'xcode_settings': {'WARNING_CFLAGS': ['-w']},
      'msvs_settings': {'VCCLCompilerTool': {'WarningLevel': 0}},
      'direct_dependent_settings': {'include_dirs': ['vendor/lunasvg/include'], 'defines': ['LUNASVG_BUILD_STATIC']}
    },
    {
      # libunibreak: the line breaking (UAX #14) and the graphemes (UAX #29)
      'target_name': 'unibreak',
      'type': 'static_library',
      'dependencies': ['cxx'],
      'sources': ['<!@(node scripts/sources.mjs unibreak)'],
      'include_dirs': ['vendor/libunibreak/src'],
      'cflags': ['-w'],
      'xcode_settings': {'WARNING_CFLAGS': ['-w']},
      'msvs_settings': {'VCCLCompilerTool': {'WarningLevel': 0}},
      'direct_dependent_settings': {'include_dirs': ['vendor/libunibreak/src']}
    },
    {
      'target_name': 'thermal',
      'sources': ['<!@(node scripts/sources.mjs thermal)'],
      'dependencies': ['cxx', 'freetype', 'gumbo', 'litehtml', 'plutovg', 'lunasvg', 'unibreak'],
      'include_dirs': ['native', "<!(node -p \"require('node-addon-api').include_dir\")"],
      # A worker thread terminated while an error is thrown to it: node-addon-api would throw a C++ exception no one
      # catches (std::terminate) where the environment refuses the JavaScript one; it lets it go instead
      'defines': ['NAPI_VERSION=8', 'NAPI_CPP_EXCEPTIONS', 'NODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS', 'NODE_ADDON_API_DISABLE_DEPRECATED']
    }
  ]
}
