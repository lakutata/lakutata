# The build of the addon of @lakutata/mongo-embedded by node-gyp, when the package is installed: the storage
# (native/store.c, which includes the amalgamation of SQLite in vendor/sqlite, its functions kept inside it), then the
# thread of each database and the functions of the addon (native/), in C++17 through node-addon-api (the C functions of
# Node-API).
{
  'targets': [
    {
      # SQLite reached through its b-tree layer (vendor/PATCHES.md): its functions static (SQLITE_API), so that a
      # process loading another SQLite (better-sqlite3, the one of the system) does not mix them; one connection per
      # thread (THREADSAFE 2); the checkpoints synced by F_FULLFSYNC on Apple, whose fsync does not order the writes
      # through the cache of the drive (the WAL is safe from a power loss by the order of its checkpoints)
      'target_name': 'store',
      'type': 'static_library',
      'sources': ['native/store.c'],
      'include_dirs': ['vendor/sqlite', 'native'],
      'defines': [
        'SQLITE_API=static',
        'SQLITE_THREADSAFE=2',
        'SQLITE_DEFAULT_MEMSTATUS=0',
        'SQLITE_DQS=0',
        'SQLITE_OMIT_LOAD_EXTENSION',
        'SQLITE_OMIT_DEPRECATED',
        'SQLITE_OMIT_SHARED_CACHE'
      ],
      'cflags': ['-w', '-fvisibility=hidden'],
      'xcode_settings': {'WARNING_CFLAGS': ['-w'], 'GCC_SYMBOLS_PRIVATE_EXTERN': 'YES', 'MACOSX_DEPLOYMENT_TARGET': '11.0'},
      'msvs_settings': {'VCCLCompilerTool': {'WarningLevel': 0}},
      'conditions': [
        ['OS=="mac" or OS=="ios"', {'defines': ['SQLITE_DEFAULT_CKPTFULLFSYNC=1']}]
      ]
    },
    {
      'target_name': 'mongo_embedded',
      'sources': ['native/addon.cc', 'native/connection.cc', 'native/database.cc', 'native/prefilter.cc'],
      'dependencies': ['store'],
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
