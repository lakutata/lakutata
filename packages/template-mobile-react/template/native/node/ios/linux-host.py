# The host tools of the iOS build made on Linux: the sources of iOS chosen for the target only (gyp chooses them for
# both toolsets, the host being a Mac in the build of nodejs-mobile)
import re
import sys

root = sys.argv[1]
p = root + '/tools/v8_gypfiles/v8.gyp'
s = open(p).read()
new = """        ['OS == "ios"', {
          'link_settings': {
            'target_conditions': [
              ['_toolset=="host" and host_os=="linux"', {'libraries': ['-ldl']}],
            ],
          },
          'target_conditions': [
            ['_toolset=="host" and host_os=="linux"', {
              'sources': [
                '<(V8_ROOT)/src/base/debug/stack_trace_posix.cc',
                '<(V8_ROOT)/src/base/platform/platform-linux.cc',
                '<(V8_ROOT)/src/base/platform/platform-linux.h',
                '<(V8_ROOT)/src/base/platform/platform-posix-time.cc',
                '<(V8_ROOT)/src/base/platform/platform-posix-time.h',
              ],
            }, {
              'sources': [
                '<(V8_ROOT)/src/base/debug/stack_trace_posix.cc',
                '<(V8_ROOT)/src/base/platform/platform-darwin.cc',
              ],
            }],
          ],
        }],"""
original = """        ['OS == "ios"', {
          'sources': [
            '<(V8_ROOT)/src/base/debug/stack_trace_posix.cc',
            '<(V8_ROOT)/src/base/platform/platform-darwin.cc',
          ]
        }],"""
if original in s:
    s = s.replace(original, new)
elif new not in s:
    # An earlier form of this patch
    s, count = re.subn(r"        \['OS == \"ios\"', \{\n          'target_conditions': \[\n.*?\n        \}\],", lambda m: new, s, count=1, flags=re.S)
    assert count == 1, 'v8.gyp: the sources of iOS not found'
open(p, 'w').write(s)
print('v8.gyp: the sources of iOS chosen per toolset')

# libuv: the sources and defines of Linux for the host tools, the ones of Apple (and kqueue) for the target
p = root + '/deps/uv/uv.gyp'
s = open(p).read()
apple = """        [ 'OS in "mac ios"', {
          'sources': [
            '<@(uv_sources_apple)',
          ],
          'defines': [
            '_DARWIN_USE_64_BIT_INODE=1',
            '_DARWIN_UNLIMITED_SELECT=1',
          ]
        }],"""
apple_new = """        [ 'OS=="mac"', {
          'sources': [
            '<@(uv_sources_apple)',
          ],
          'defines': [
            '_DARWIN_USE_64_BIT_INODE=1',
            '_DARWIN_UNLIMITED_SELECT=1',
          ]
        }],
        [ 'OS=="ios"', {
          'link_settings': {
            'target_conditions': [
              ['_toolset=="host" and host_os=="linux"', {'libraries': [ '-ldl', '-lrt' ]}],
            ],
          },
          'target_conditions': [
            ['_toolset=="host" and host_os=="linux"', {
              'defines': [ '_GNU_SOURCE' ],
              'sources': [ '<@(uv_sources_linux)' ],
            }, {
              'defines': [
                '_DARWIN_USE_64_BIT_INODE=1',
                '_DARWIN_UNLIMITED_SELECT=1',
              ],
              'sources': [ '<@(uv_sources_apple)', '<@(uv_sources_bsd_common)' ],
            }],
          ],
        }],"""
bsd = """        [ 'OS in "ios mac freebsd dragonflybsd openbsd netbsd".split()', {"""
bsd_new = """        [ 'OS in "mac freebsd dragonflybsd openbsd netbsd".split()', {"""
if apple in s:
    assert s.count(bsd) == 1, 'uv.gyp: the BSD sources not found'
    s = s.replace(apple, apple_new).replace(bsd, bsd_new)
    open(p, 'w').write(s)
print('uv.gyp: the sources of iOS chosen per toolset')
