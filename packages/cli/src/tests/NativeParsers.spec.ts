import {describe, it} from 'node:test'
import assert from 'node:assert'
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {applyEdits} from '../lib/native/TextEdits.js'
import {findGypTarget, GypDocument, type GypDict, type GypList} from '../lib/native/Gyp.js'
import {CMakeDocument} from '../lib/native/CMake.js'
import {TomlDocument} from '../lib/native/Toml.js'

/**
 * The lines added to a text by its edits: the text without them is the original one
 * @param before
 * @param after
 */
function addedLines(before: string, after: string): string[] {
    const lines: string[] = after.split('\n')
    const original: string[] = before.split('\n')
    const added: string[] = []
    let index: number = 0
    for (const line of lines) {
        if (original[index] === line) index++
        else added.push(line)
    }
    assert.strictEqual(index, original.length, `The original lines are kept:\n${after}`)
    return added
}

describe('The gyp files', (): void => {
    it('are parsed as Python literals: comments, quotes, prefixes, adjacent strings, numbers, tuples, trailing commas, repeated keys', (): void => {
        const document: GypDocument = new GypDocument('a.gyp', `# A comment with 'quotes' and "quotes"
{
  'variables': {'version': 1.5, 'enabled': True, 'nothing': None, 'mask': 0x1F},
  'targets': [{
    "target_name": r'raw\\path',  # a raw string
    'sources': ('a.cc', 'b' "c.cc"),
    'description': '''long
text''',
    'escaped': 'it\\'s',
    'cflags': [],
  }],
  'targets': [{'target_name': 'last'}],
}`)
        const targets = GypDocument.get(document.root, 'targets') as GypList
        //The last of the repeated keys, as Python
        assert.strictEqual((GypDocument.get(targets.items[0] as GypDict, 'target_name') as { value: string }).value, 'last')
        const first: GypDict = (document.root.entries[1].value as GypList).items[0] as GypDict
        assert.strictEqual((GypDocument.get(first, 'target_name') as { value: string }).value, 'raw\\path')
        assert.deepStrictEqual((GypDocument.get(first, 'sources') as GypList).items.map((item): unknown => (item as { value: string }).value), ['a.cc', 'bc.cc'])
        assert.strictEqual((GypDocument.get(first, 'description') as { value: string }).value, 'long\ntext')
        assert.strictEqual((GypDocument.get(first, 'escaped') as { value: string }).value, 'it\'s')
        assert.throws((): unknown => new GypDocument('b.gyp', "{'a': [1, 2}"), /b\.gyp:1:12: expected "," or "\]"/)
        assert.throws((): unknown => new GypDocument('c.gyp', "{'a': true}"), /unexpected "t"/)
    })

    it('are changed by edits keeping their text, their comments, in their quotes and indentation', (): void => {
        const text: string = `{
    # The targets
    "targets": [
        {
            "target_name": "addon",
            "libraries": [
                "-lpcap"  # the capture
            ],
            "defines": [
                # none yet
            ],
            "cflags": []
        }
    ]
}
`
        let document: GypDocument = new GypDocument('binding.gyp', text)
        const target = (): GypDict => (GypDocument.get(document.root, 'targets') as GypList).items[0] as GypDict
        for (const [key, values] of [['libraries', ['-lz', '-lpcap']], ['defines', ['TRACE=1']], ['cflags', ['-O2']], ['include_dirs', ['deps/include']]] as [string, string[]][]) {
            assert.ok(document.addToList(target(), key, values))
            document = document.applied()
        }
        assert.ok(document.addEntry(target(), 'conditions', [['OS=="mac"', {xcode_settings: {OTHER_LDFLAGS: ['-framework IOKit']}}]]))
        document = document.applied()
        //Already there: nothing changed
        assert.ok(!document.addToList(target(), 'libraries', ['-lz']))
        assert.ok(!document.addEntry(target(), 'conditions', []))
        assert.strictEqual(document.text, `{
    # The targets
    "targets": [
        {
            "target_name": "addon",
            "libraries": [
                "-lpcap",  # the capture
                "-lz"
            ],
            "defines": [
                # none yet
                "TRACE=1"
            ],
            "cflags": ["-O2"],
            "include_dirs": ["deps/include"],
            "conditions": [
                ['OS=="mac"', {
                    "xcode_settings": {
                        "OTHER_LDFLAGS": ["-framework IOKit"]
                    }
                }]
            ]
        }
    ]
}
`)
    })

    it('are changed in their single quotes, their lists on one line, their trailing commas', (): void => {
        let document: GypDocument = new GypDocument('binding.gyp', "{'targets': [{'target_name': 'a', 'sources': ['a.cc',],}]}")
        const target = (): GypDict => (GypDocument.get(document.root, 'targets') as GypList).items[0] as GypDict
        document.addToList(target(), 'sources', ['b.cc'])
        document = document.applied()
        document.addToList(target(), 'defines', ['A'])
        document = document.applied()
        assert.strictEqual(document.text, "{'targets': [{'target_name': 'a', 'sources': ['a.cc', 'b.cc',], 'defines': ['A'],}]}")
    })

    it('find their targets in the files they include', async (): Promise<void> => {
        const directory: string = mkdtempSync(path.join(tmpdir(), 'lakutata-gyp-'))
        mkdirSync(path.join(directory, 'cpp'))
        writeFileSync(path.join(directory, 'binding.gyp'), '{"includes": ["cpp/addon.gypi"]}\n')
        writeFileSync(path.join(directory, 'cpp', 'addon.gypi'), '{\n  "targets": [\n    {"target_name": "first"},\n    {"target_name": "second"}\n  ]\n}\n')
        const {document, target} = await findGypTarget(path.join(directory, 'binding.gyp'), 'second')
        assert.strictEqual(document.file, path.join(directory, 'cpp', 'addon.gypi'))
        assert.strictEqual((GypDocument.get(target, 'target_name') as { value: string }).value, 'second')
        await assert.rejects(findGypTarget(path.join(directory, 'binding.gyp')), /several targets \(first, second\): --target/)
        await assert.rejects(findGypTarget(path.join(directory, 'binding.gyp'), 'third'), /no target third \(first, second\)/)
    })
})

describe('The CMake files', (): void => {
    const text: string = `cmake_minimum_required(VERSION 3.15)
#[==[ A bracket comment
with ) and " inside ]==]
project(capture)
set(SOURCES cpp/binding.cc "cpp/with space.cc")
add_library(\${PROJECT_NAME} SHARED \${SOURCES})
if(MSVC)
    target_compile_options(\${PROJECT_NAME} PRIVATE /utf-8)
endif()
target_link_libraries(\${PROJECT_NAME} \${CMAKE_JS_LIB}) # the library of node
message(STATUS [=[a bracket
argument]=] "a \\"quoted\\" one" unquoted(nested parentheses) -Da="b c")
`

    it('are parsed by the grammar of cmake-language: the bracket, quoted and unquoted arguments, the comments, the blocks', (): void => {
        const document: CMakeDocument = new CMakeDocument('CMakeLists.txt', text)
        assert.deepStrictEqual(document.commands.map((command): string => `${command.depth}:${command.name}`), ['0:cmake_minimum_required', '0:project', '0:set', '0:add_library', '0:if', '1:target_compile_options', '0:endif', '0:target_link_libraries', '0:message'])
        const message = document.commands.at(-1)!
        assert.deepStrictEqual(message.args.map((arg): string => arg.value), ['STATUS', 'a bracket\nargument', 'a "quoted" one', 'unquoted', '(', 'nested', 'parentheses', ')', '-Da="b c"'])
        //The targets, their variables resolved
        assert.deepStrictEqual(document.targets().map((target): string[] => [target.name, target.text]), [['capture', '${PROJECT_NAME}']])
        assert.throws((): unknown => new CMakeDocument('Bad.txt', 'project(a\n'), /Bad\.txt:2:1: unterminated command/)
    })

    it('are changed by commands inserted after the ones of the target, in blocks of their platform, once', (): void => {
        let document: CMakeDocument = new CMakeDocument('CMakeLists.txt', text)
        document.insertAfterTarget(document.target(), ['target_link_libraries(${PROJECT_NAME} PRIVATE z)'])
        document = document.applied()
        document.insertAfterTarget(document.target('capture'), ['target_link_libraries(${PROJECT_NAME} PRIVATE "-framework IOKit")'], 'APPLE')
        document = document.applied()
        assert.deepStrictEqual(addedLines(text, document.text), [
            'target_link_libraries(${PROJECT_NAME} PRIVATE z)',
            'if(APPLE)',
            '    target_link_libraries(${PROJECT_NAME} PRIVATE "-framework IOKit")',
            'endif()'
        ])
        //After the comment of the last command of the target
        assert.match(document.text, /# the library of node\ntarget_link_libraries\(\$\{PROJECT_NAME\} PRIVATE z\)\nif\(APPLE\)/)
        assert.ok(document.has('target_link_libraries', ['${PROJECT_NAME}', 'PRIVATE', 'z']))
        assert.ok(document.has('target_link_libraries', ['capture', 'PRIVATE', '-framework IOKit']))
        assert.ok(!document.has('target_link_libraries', ['capture', 'PRIVATE', 'pcap']))
    })
})

describe('The TOML files', (): void => {
    it('are parsed by TOML 1.0: the tables, the dotted and quoted keys, the strings, the arrays and the inline tables', (): void => {
        const document: TomlDocument = new TomlDocument('config.toml', `# The configuration
title = "TOML \\"Example\\" \\u00e9"
literal = 'C:\\path'
multi = """
Roses are red
Violets are "blue"\\
  , end"""
multiliteral = '''it's'''
date = 1979-05-27T07:32:00Z
space = 1979-05-27 07:32:00
numbers = [1, 2.5, -3e2, 0xff, inf, nan, true]
inline = {name = "a", nested = {key = 1}}

[target.'cfg(target_os = "macos")']
rustflags = [
  "-C", "link-arg=-Wl,-rpath,@loader_path", # the rpath
]

[[bin]]
name = "first"
a.b."c d" = 1
`)
        assert.deepStrictEqual(document.tables.map((table): string => `${table.array ? '[[' : '['}${table.path.join('|')}`), ['[', '[target|cfg(target_os = "macos")', '[[bin'])
        const root = document.tables[0]
        const value = (key: string): unknown => (root.entries.find((entry): boolean => entry.key[0] === key)!.value as { value?: string, text?: string })
        assert.strictEqual((value('title') as { value: string }).value, 'TOML "Example" é')
        assert.strictEqual((value('literal') as { value: string }).value, 'C:\\path')
        assert.strictEqual((value('multi') as { value: string }).value, 'Roses are red\nViolets are "blue", end')
        assert.strictEqual((value('multiliteral') as { value: string }).value, 'it\'s')
        assert.strictEqual((value('space') as { text: string }).text, '1979-05-27 07:32:00')
        assert.deepStrictEqual(document.tables[2].entries[1].key, ['a', 'b', 'c d'])
        assert.throws((): unknown => new TomlDocument('bad.toml', 'a = [1, 2'), /bad\.toml:1:10: expected "," or "\]"/)
    })

    it('are changed by the lists in the strings of their tables, created when missing, their comments kept, the values already given skipped', (): void => {
        const text: string = `# The configuration of cargo
[build]
jobs = 4 # the jobs

[env]
# The libraries of every platform
LAKUTATA_NATIVE = "rustc-link-lib=z"
`
        let document: TomlDocument = new TomlDocument('config.toml', text)
        assert.ok(document.addToStringList(['env'], 'LAKUTATA_NATIVE', ['rustc-link-lib=z', 'rustc-link-lib=pcap'], ';'))
        document = document.applied()
        assert.ok(document.addToStringList(['env'], 'LAKUTATA_NATIVE_MACOS', ['rustc-link-lib=framework=IOKit'], ';'))
        document = document.applied()
        assert.ok(document.addToStringList(['target', 'cfg(all())'], 'value', ['a', 'b'], ' '))
        document = document.applied()
        assert.ok(!document.addToStringList(['env'], 'LAKUTATA_NATIVE', ['rustc-link-lib=pcap'], ';'))
        assert.strictEqual(document.string(['env'], 'LAKUTATA_NATIVE'), 'rustc-link-lib=z;rustc-link-lib=pcap')
        assert.strictEqual(document.text, `# The configuration of cargo
[build]
jobs = 4 # the jobs

[env]
# The libraries of every platform
LAKUTATA_NATIVE = "rustc-link-lib=z;rustc-link-lib=pcap"
LAKUTATA_NATIVE_MACOS = "rustc-link-lib=framework=IOKit"

[target.'cfg(all())']
value = "a b"
`)
        assert.throws((): unknown => document.addToStringList(['build'], 'jobs', ['1'], ';'), /config\.toml:3:8: "jobs" is not a string/)
        //A file created
        const created: TomlDocument = new TomlDocument('new.toml', '')
        created.addToStringList(['env'], 'LAKUTATA_NATIVE', ['rustc-link-lib=z'], ';')
        assert.strictEqual(applyEdits('', created.changes), '[env]\nLAKUTATA_NATIVE = "rustc-link-lib=z"\n')
        //An entry after the last line without its newline
        const unterminated: TomlDocument = new TomlDocument('end.toml', '[env]\nA = "1"')
        unterminated.addToStringList(['env'], 'B', ['2'], ';')
        assert.strictEqual(applyEdits(unterminated.text, unterminated.changes), '[env]\nA = "1"\nB = "2"\n')
    })
})
