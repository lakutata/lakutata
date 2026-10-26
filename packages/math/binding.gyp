# The build of the addon of @lakutata/math by node-gyp, when the package is installed: SymEngine and mpdecimal compiled
# from their vendored sources (vendor/, scripts/sync.mjs) as static libraries, then the addon (native/) linked with
# them. The lists of sources come from scripts/sources.mjs. C++17 for every target: the addon uses the C functions of
# Node-API (through node-addon-api, a dependency of the package), not the headers of V8 the C++20 of node-gyp is for.
{
  'targets': [
    {
      # The settings of C++ of every target, given by depending on this one (as node-addon-api gives its exceptions): the
      # settings of a dependency are merged after the ones of node-gyp (no exceptions, no RTTI, C++20), which they replace
      'target_name': 'cxx',
      'type': 'none',
      'direct_dependent_settings': {
        'cflags!': ['-fno-exceptions'],
        'cflags_cc!': ['-fno-exceptions', '-fno-rtti', '-std=gnu++20', '-std=gnu++17'],
        'cflags_cc': ['-std=c++17', '-fexceptions', '-frtti'],
        'conditions': [
          ['OS=="mac"', {
            'xcode_settings': {
              'GCC_ENABLE_CPP_EXCEPTIONS': 'YES',
              'GCC_ENABLE_CPP_RTTI': 'YES',
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
                'RuntimeTypeInfo': 'true',
                'LanguageStandard': 'stdcpp17',
                # The Release configuration of node-gyp turns RTTI off and asks C++20: the options given last win
                'AdditionalOptions': ['/bigobj', '/utf-8', '/GR', '/std:c++17']
              }
            }
          }]
        ]
      }
    },
    {
      # mpdecimal: 64 or 32 bits by the architecture; 128-bit integers of GCC and Clang for its divisions on 64 bits
      'target_name': 'mpdecimal',
      'type': 'static_library',
      'dependencies': ['cxx'],
      'sources': ['<!@(node scripts/sources.mjs mpdecimal)'],
      'include_dirs': ['native/config/mpdecimal', 'vendor/mpdecimal/libmpdec'],
      'defines': ['ANSI'],
      'cflags': ['-w'],
      'xcode_settings': {'WARNING_CFLAGS': ['-w']},
      'msvs_settings': {'VCCLCompilerTool': {'WarningLevel': 0}},
      'conditions': [
        ['target_arch=="x64" or target_arch=="arm64" or target_arch=="ppc64" or target_arch=="s390x" or target_arch=="riscv64" or target_arch=="loong64"', {
          'defines': ['CONFIG_64'],
          'conditions': [['OS!="win"', {'defines': ['HAVE_UINT128_T']}]]
        }, {
          'defines': ['CONFIG_32']
        }]
      ],
      'direct_dependent_settings': {'include_dirs': ['native/config/mpdecimal']}
    },
    {
      # SymEngine: the integers of Boost.Multiprecision (no GMP), atomic reference counts (native/config/symengine)
      'target_name': 'symengine',
      'type': 'static_library',
      'dependencies': ['cxx'],
      'sources': ['<!@(node scripts/sources.mjs symengine)'],
      'include_dirs': ['native/config', 'vendor/symengine', 'vendor/symengine/symengine/utilities/cereal/include', 'vendor/symengine/symengine/utilities/fast_float/include', 'vendor/boost/multiprecision/include', 'vendor/boost/config/include'],
      'defines': ['BOOST_MP_STANDALONE'],
      'cflags_cc': ['-w'],
      'xcode_settings': {'WARNING_CFLAGS': ['-w']},
      'msvs_settings': {'VCCLCompilerTool': {'WarningLevel': 0}},
      'direct_dependent_settings': {
        'include_dirs': ['native/config', 'vendor/symengine', 'vendor/symengine/symengine/utilities/cereal/include', 'vendor/symengine/symengine/utilities/fast_float/include', 'vendor/boost/multiprecision/include', 'vendor/boost/config/include'],
        'defines': ['BOOST_MP_STANDALONE']
      }
    },
    {
      'target_name': 'math',
      'sources': ['<!@(node scripts/sources.mjs math)'],
      'dependencies': ['cxx', 'mpdecimal', 'symengine'],
      'include_dirs': ['native', "<!(node -p \"require('node-addon-api').include_dir\")", 'vendor/eigen'],
      'defines': ['NAPI_VERSION=8', 'NAPI_CPP_EXCEPTIONS', 'NODE_ADDON_API_DISABLE_DEPRECATED', 'EIGEN_MPL2_ONLY']
    }
  ]
}
