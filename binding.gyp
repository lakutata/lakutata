{
""
  "targets": [
    {
      "target_name": "lakutata",
      'cflags!': [ '-fno-exceptions' ],
	  'cflags_cc!': [ '-fno-exceptions' ],
	  'xcode_settings': {
		'GCC_ENABLE_CPP_EXCEPTIONS': 'YES',
		'CLANG_CXX_LIBRARY': 'libc++',
		'MACOSX_DEPLOYMENT_TARGET': '10.7',
	  },
	  'msvs_settings': {
		'VCCLCompilerTool': { 'ExceptionHandling': 1 },
	  },
      "sources": [ "src/cpp/hello.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      'defines': [ 'NAPI_DISABLE_CPP_EXCEPTIONS' ],
    }
  ]
}
