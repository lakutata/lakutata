# The build of the addon of @lakutata/mongo-embedded by node-gyp, when the package is installed: the storage
# (native/store.c, which includes the amalgamation of SQLite, native/engine/engine.c, its functions kept inside it),
# the collation of ICU (vendor/icu: the sources of common and i18n its collators use), the text of the text indexes
# (native/text, with the stemmers of Snowball), then the thread of each database
# and the functions of the addon (native/), in C++17 through node-addon-api (the C functions of Node-API).
{
  'variables': {
    # ICU built for its collators only (vendor/PATCHES.md): static, its functions and classes renamed with a suffix of
    # the package (ucol_open_77_mde, the namespace icu_77_mde), hidden, so that the ICU of Node.js or Electron is not
    # mixed with it; its data given by the addon (no files read by ICU), the parts the collators do not use left out
    'icu_defines': [
      'U_STATIC_IMPLEMENTATION',
      'U_LIB_SUFFIX_C_NAME=_mde',
      'UCONFIG_NO_FILE_IO=1',
      'UCONFIG_NO_BREAK_ITERATION=1',
      'UCONFIG_NO_FORMATTING=1',
      'UCONFIG_NO_TRANSLITERATION=1',
      'UCONFIG_NO_REGULAR_EXPRESSIONS=1',
      'UCONFIG_NO_IDNA=1',
      'UCONFIG_NO_SERVICE=1',
      'UCONFIG_NO_LEGACY_CONVERSION=1',
      'UCONFIG_NO_CONVERSION=1',
      'U_ENABLE_DYLOAD=0',
      'U_CHARSET_IS_UTF8=1'
    ],
    'icu_include_dirs': ['vendor/icu/source/common', 'vendor/icu/source/i18n']
  },
  'targets': [
    {
      # SQLite reached through its b-tree layer (vendor/PATCHES.md): its functions static (SQLITE_API), so that a
      # process loading another SQLite (better-sqlite3, the one of the system) does not mix them; one connection per
      # thread (THREADSAFE 2); the checkpoints synced by F_FULLFSYNC on Apple, whose fsync does not order the writes
      # through the cache of the drive (the WAL is safe from a power loss by the order of its checkpoints)
      'target_name': 'store',
      'type': 'static_library',
      'sources': ['native/store.c'],
      'include_dirs': ['native/engine', 'native'],
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
      # The common library of ICU (and its stub of the data, the data given by the addon)
      'target_name': 'icu_common',
      'type': 'static_library',
      'sources': [
        'vendor/icu/source/common/bmpset.cpp', 'vendor/icu/source/common/bytesinkutil.cpp',
        'vendor/icu/source/common/bytestream.cpp', 'vendor/icu/source/common/bytestrie.cpp',
        'vendor/icu/source/common/characterproperties.cpp', 'vendor/icu/source/common/charstr.cpp',
        'vendor/icu/source/common/cmemory.cpp', 'vendor/icu/source/common/cstring.cpp',
        'vendor/icu/source/common/edits.cpp', 'vendor/icu/source/common/emojiprops.cpp',
        'vendor/icu/source/common/localebuilder.cpp', 'vendor/icu/source/common/localematcher.cpp',
        'vendor/icu/source/common/locavailable.cpp', 'vendor/icu/source/common/locdispnames.cpp',
        'vendor/icu/source/common/locdistance.cpp', 'vendor/icu/source/common/locid.cpp',
        'vendor/icu/source/common/loclikely.cpp', 'vendor/icu/source/common/loclikelysubtags.cpp',
        'vendor/icu/source/common/locmap.cpp', 'vendor/icu/source/common/lsr.cpp',
        'vendor/icu/source/common/normalizer2.cpp', 'vendor/icu/source/common/normalizer2impl.cpp',
        'vendor/icu/source/common/patternprops.cpp', 'vendor/icu/source/common/propname.cpp',
        'vendor/icu/source/common/putil.cpp', 'vendor/icu/source/common/resource.cpp',
        'vendor/icu/source/common/sharedobject.cpp', 'vendor/icu/source/common/stringpiece.cpp',
        'vendor/icu/source/common/uarrsort.cpp', 'vendor/icu/source/common/ubidiln.cpp',
        'vendor/icu/source/common/ucharstrie.cpp', 'vendor/icu/source/common/ucharstrieiterator.cpp',
        'vendor/icu/source/common/ucln_cmn.cpp', 'vendor/icu/source/common/ucmndata.cpp',
        'vendor/icu/source/common/ucptrie.cpp', 'vendor/icu/source/common/udata.cpp',
        'vendor/icu/source/common/udatamem.cpp', 'vendor/icu/source/common/uenum.cpp',
        'vendor/icu/source/common/uhash.cpp', 'vendor/icu/source/common/uinvchar.cpp',
        'vendor/icu/source/common/uiter.cpp', 'vendor/icu/source/common/uloc.cpp',
        'vendor/icu/source/common/uloc_keytype.cpp', 'vendor/icu/source/common/uloc_tag.cpp',
        'vendor/icu/source/common/umapfile.cpp', 'vendor/icu/source/common/umath.cpp',
        'vendor/icu/source/common/umutablecptrie.cpp', 'vendor/icu/source/common/umutex.cpp',
        'vendor/icu/source/common/unames.cpp', 'vendor/icu/source/common/unifiedcache.cpp',
        'vendor/icu/source/common/unifilt.cpp', 'vendor/icu/source/common/unifunct.cpp',
        'vendor/icu/source/common/uniset.cpp', 'vendor/icu/source/common/uniset_closure.cpp',
        'vendor/icu/source/common/unisetspan.cpp', 'vendor/icu/source/common/unistr.cpp',
        'vendor/icu/source/common/uobject.cpp', 'vendor/icu/source/common/uprops.cpp',
        'vendor/icu/source/common/uresbund.cpp', 'vendor/icu/source/common/uresdata.cpp',
        'vendor/icu/source/common/uset.cpp', 'vendor/icu/source/common/usetiter.cpp',
        'vendor/icu/source/common/ustrenum.cpp', 'vendor/icu/source/common/ustring.cpp',
        'vendor/icu/source/common/ustrtrns.cpp', 'vendor/icu/source/common/utf_impl.cpp',
        'vendor/icu/source/common/util.cpp', 'vendor/icu/source/common/utrace.cpp',
        'vendor/icu/source/common/utrie2.cpp', 'vendor/icu/source/common/utypes.cpp',
        'vendor/icu/source/common/uvector.cpp', 'vendor/icu/source/common/uvectr32.cpp',
        'vendor/icu/source/common/wintz.cpp', 'vendor/icu/source/stubdata/stubdata.cpp'
      ],
      # The linker of Windows resolves the symbols of the functions the other linkers strip as unused: the files
      # defining them (vendor/PATCHES.md)
      'conditions': [
        ['OS=="win"', {
          'sources': [
            'vendor/icu/source/common/appendable.cpp', 'vendor/icu/source/common/caniter.cpp',
            'vendor/icu/source/common/errorcode.cpp', 'vendor/icu/source/common/loadednormalizer2impl.cpp',
            'vendor/icu/source/common/localeprioritylist.cpp', 'vendor/icu/source/common/locresdata.cpp',
            'vendor/icu/source/common/parsepos.cpp', 'vendor/icu/source/common/ruleiter.cpp',
            'vendor/icu/source/common/stringtriebuilder.cpp', 'vendor/icu/source/common/ubidi.cpp',
            'vendor/icu/source/common/ubidi_props.cpp', 'vendor/icu/source/common/ubidiwrt.cpp',
            'vendor/icu/source/common/ucase.cpp', 'vendor/icu/source/common/uchar.cpp',
            'vendor/icu/source/common/ucharstriebuilder.cpp', 'vendor/icu/source/common/ucol_swp.cpp',
            'vendor/icu/source/common/udataswp.cpp', 'vendor/icu/source/common/ulist.cpp',
            'vendor/icu/source/common/uniset_props.cpp', 'vendor/icu/source/common/unistr_case.cpp',
            'vendor/icu/source/common/unistr_case_locale.cpp', 'vendor/icu/source/common/uscript_props.cpp',
            'vendor/icu/source/common/uset_props.cpp', 'vendor/icu/source/common/ustrcase.cpp',
            'vendor/icu/source/common/ustrcase_locale.cpp', 'vendor/icu/source/common/utrie.cpp',
            'vendor/icu/source/common/utrie2_builder.cpp', 'vendor/icu/source/common/utrie_swap.cpp',
            'vendor/icu/source/common/uvectr64.cpp'
          ]
        }]
      ],
      'include_dirs': ['<@(icu_include_dirs)'],
      'defines': ['<@(icu_defines)', 'U_COMMON_IMPLEMENTATION'],
      'cflags': ['-w', '-fvisibility=hidden', '-ffunction-sections', '-fdata-sections'],
      'cflags_cc!': ['-fno-rtti', '-std=gnu++20', '-std=gnu++17'],
      'cflags_cc': ['-std=c++17'],
      'xcode_settings': {
        'WARNING_CFLAGS': ['-w'],
        'GCC_SYMBOLS_PRIVATE_EXTERN': 'YES',
        'GCC_ENABLE_CPP_RTTI': 'YES',
        'CLANG_CXX_LANGUAGE_STANDARD': 'c++17',
        'MACOSX_DEPLOYMENT_TARGET': '11.0'
      },
      # RTTI for its dynamic_cast: the Release configuration of node-gyp turns it off (/GR-), /GR given last turns it on
      'msvs_settings': {'VCCLCompilerTool': {'WarningLevel': 0, 'RuntimeTypeInfo': 'true', 'AdditionalOptions': ['/utf-8', '/std:c++17', '/GR']}},
      'direct_dependent_settings': {'include_dirs': ['<@(icu_include_dirs)'], 'defines': ['<@(icu_defines)']}
    },
    {
      # The collators of ICU (its library i18n, the parts they use)
      'target_name': 'icu_i18n',
      'type': 'static_library',
      'sources': [
        'vendor/icu/source/i18n/bocsu.cpp', 'vendor/icu/source/i18n/coleitr.cpp', 'vendor/icu/source/i18n/coll.cpp',
        'vendor/icu/source/i18n/collation.cpp', 'vendor/icu/source/i18n/collationbuilder.cpp',
        'vendor/icu/source/i18n/collationcompare.cpp', 'vendor/icu/source/i18n/collationdata.cpp',
        'vendor/icu/source/i18n/collationdatareader.cpp', 'vendor/icu/source/i18n/collationfastlatin.cpp',
        'vendor/icu/source/i18n/collationfcd.cpp', 'vendor/icu/source/i18n/collationiterator.cpp',
        'vendor/icu/source/i18n/collationkeys.cpp', 'vendor/icu/source/i18n/collationroot.cpp',
        'vendor/icu/source/i18n/collationruleparser.cpp', 'vendor/icu/source/i18n/collationsets.cpp',
        'vendor/icu/source/i18n/collationsettings.cpp', 'vendor/icu/source/i18n/collationtailoring.cpp',
        'vendor/icu/source/i18n/decNumber.cpp', 'vendor/icu/source/i18n/rulebasedcollator.cpp',
        'vendor/icu/source/i18n/sortkey.cpp', 'vendor/icu/source/i18n/ucln_in.cpp',
        'vendor/icu/source/i18n/ucol.cpp', 'vendor/icu/source/i18n/ucol_res.cpp',
        'vendor/icu/source/i18n/uitercollationiterator.cpp', 'vendor/icu/source/i18n/utf16collationiterator.cpp',
        'vendor/icu/source/i18n/utf8collationiterator.cpp'
      ],
      # The files the linker of Windows needs too (see icu_common)
      'conditions': [
        ['OS=="win"', {
          'sources': [
            'vendor/icu/source/i18n/collationdatabuilder.cpp', 'vendor/icu/source/i18n/collationdatawriter.cpp',
            'vendor/icu/source/i18n/collationfastlatinbuilder.cpp', 'vendor/icu/source/i18n/collationrootelements.cpp',
            'vendor/icu/source/i18n/collationweights.cpp', 'vendor/icu/source/i18n/decContext.cpp',
            'vendor/icu/source/i18n/ucol_sit.cpp'
          ]
        }]
      ],
      'dependencies': ['icu_common'],
      'include_dirs': ['<@(icu_include_dirs)'],
      'defines': ['<@(icu_defines)', 'U_I18N_IMPLEMENTATION'],
      'cflags': ['-w', '-fvisibility=hidden', '-ffunction-sections', '-fdata-sections'],
      'cflags_cc!': ['-fno-rtti', '-std=gnu++20', '-std=gnu++17'],
      'cflags_cc': ['-std=c++17'],
      'xcode_settings': {
        'WARNING_CFLAGS': ['-w'],
        'GCC_SYMBOLS_PRIVATE_EXTERN': 'YES',
        'GCC_ENABLE_CPP_RTTI': 'YES',
        'CLANG_CXX_LANGUAGE_STANDARD': 'c++17',
        'MACOSX_DEPLOYMENT_TARGET': '11.0'
      },
      # RTTI for its dynamic_cast: the Release configuration of node-gyp turns it off (/GR-), /GR given last turns it on
      'msvs_settings': {'VCCLCompilerTool': {'WarningLevel': 0, 'RuntimeTypeInfo': 'true', 'AdditionalOptions': ['/utf-8', '/std:c++17', '/GR']}},
      'direct_dependent_settings': {'include_dirs': ['<@(icu_include_dirs)'], 'defines': ['<@(icu_defines)']}
    },
    {
      # The text of the text indexes (native/text): the words, their case folding, the stop words and the diacritics of
      # Unicode 8.0 (native/text/tables.h, scripts/text-tables.mjs), the stemmers of Snowball (vendor/libstemmer_c) of
      # the languages of MongoDB, hidden
      'target_name': 'text',
      'type': 'static_library',
      'sources': [
        'native/text/text.c', 'vendor/libstemmer_c/runtime/api.c', 'vendor/libstemmer_c/runtime/utilities.c',
        'vendor/libstemmer_c/src_c/stem_UTF_8_danish.c', 'vendor/libstemmer_c/src_c/stem_UTF_8_dutch.c', 'vendor/libstemmer_c/src_c/stem_UTF_8_english.c',
        'vendor/libstemmer_c/src_c/stem_UTF_8_finnish.c', 'vendor/libstemmer_c/src_c/stem_UTF_8_french.c', 'vendor/libstemmer_c/src_c/stem_UTF_8_german.c',
        'vendor/libstemmer_c/src_c/stem_UTF_8_hungarian.c', 'vendor/libstemmer_c/src_c/stem_UTF_8_italian.c', 'vendor/libstemmer_c/src_c/stem_UTF_8_norwegian.c',
        'vendor/libstemmer_c/src_c/stem_UTF_8_portuguese.c', 'vendor/libstemmer_c/src_c/stem_UTF_8_romanian.c', 'vendor/libstemmer_c/src_c/stem_UTF_8_russian.c',
        'vendor/libstemmer_c/src_c/stem_UTF_8_spanish.c', 'vendor/libstemmer_c/src_c/stem_UTF_8_swedish.c', 'vendor/libstemmer_c/src_c/stem_UTF_8_turkish.c'
      ],
      'include_dirs': ['native/text', 'vendor/libstemmer_c/runtime', 'vendor/libstemmer_c/src_c'],
      'cflags': ['-w', '-fvisibility=hidden'],
      'xcode_settings': {'WARNING_CFLAGS': ['-w'], 'GCC_SYMBOLS_PRIVATE_EXTERN': 'YES', 'MACOSX_DEPLOYMENT_TARGET': '11.0'},
      'msvs_settings': {'VCCLCompilerTool': {'WarningLevel': 0, 'AdditionalOptions': ['/utf-8']}}
    },
    {
      'target_name': 'mongo_embedded',
      'sources': ['native/addon.cc', 'native/collation.cc', 'native/connection.cc', 'native/database.cc', 'native/prefilter.cc'],
      'dependencies': ['store', 'text', 'icu_i18n', 'icu_common'],
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
            'MACOSX_DEPLOYMENT_TARGET': '11.0',
            'DEAD_CODE_STRIPPING': 'YES'
          }
        }],
        ['OS=="linux" or OS=="android"', {'ldflags': ['-Wl,--gc-sections']}],
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
