import path from 'node:path'
import {NativeLibrary} from '../../components/NativeLibrary.js'
import {builtinTypes} from '../declarations/Builtins.js'
import type {Token} from '../declarations/Lexer.js'
import {DeclarationParser, type MacroOrigin, type SourceDeclaration, type SourceDeclarations} from '../declarations/Parser.js'
import {CURRENT_PLATFORM, type Platform} from '../declarations/Platform.js'
import type {CType, FunctionDeclaration, RecordType, VariableDeclaration} from '../declarations/Types.js'
import {loadNativeLibrary, type NativeLibraryHandle} from '../library/NativeLibraryHandle.js'
import {declarationText, prunedTokens} from './CText.js'
import {preprocessHeader, type PreprocessedHeader, type PreprocessOptions} from './Preprocessor.js'
import {TypeScriptTypes} from './TypeScriptTypes.js'

/**
 * How a library is generated from its header
 */
export interface GenerateOptions extends PreprocessOptions {
    /**
     * The library its functions are checked against: a name, as `@Library` takes it, or a file. The name of the header
     * by default (`sqlite3.h`: `sqlite3`): give it when that library cannot be loaded (the report tells why the
     * functions were not checked).
     */
    readonly library?: string
    /**
     * The name of the class. The name of the header in PascalCase by default (`sqlite3.h`: `Sqlite3`).
     */
    readonly className?: string
    /**
     * More directories whose headers are the ones of the library: the header is, and so are the headers of its
     * directory when it is not a directory of the system.
     */
    readonly own?: readonly string[]
    /**
     * Whether the functions and the variables are checked against the library, the ones it cannot give left out.
     * @default true
     */
    readonly check?: boolean
}

/**
 * A declaration of the header that was left out, and why
 */
export interface SkippedDeclaration {
    /**
     * Its name, or the start of its text
     */
    readonly name: string
    /**
     * The file it comes from
     */
    readonly file?: string
    /**
     * Its line in that file
     */
    readonly line?: number
    /**
     * Why it was left out
     */
    readonly reason: string
}

/**
 * What the generation did
 */
export interface GenerationReport {
    /**
     * The command that ran the preprocessor
     */
    readonly command: string
    /**
     * The platform the library was generated for (`darwin-arm64`)
     */
    readonly platform: string
    /**
     * The file of the library the functions were checked against
     */
    readonly library?: string
    /**
     * Why they were not checked
     */
    readonly unchecked?: string
    /**
     * The functions of the class
     */
    readonly functions: number
    /**
     * The variables of the class
     */
    readonly variables: number
    /**
     * The interfaces of the structs and unions
     */
    readonly interfaces: number
    /**
     * The constants of the declarations: the integer macros, the values of the enums, the static constants
     */
    readonly constants: number
    /**
     * The declarations of the library left out: the ones that cannot be read, the functions and variables the library
     * cannot give
     */
    readonly skipped: readonly SkippedDeclaration[]
}

/**
 * A library generated from its header
 */
export interface GeneratedLibrary {
    /**
     * The name of its class
     */
    readonly className: string
    /**
     * The TypeScript code of its class
     */
    readonly code: string
    /**
     * Its C declarations, as the class gives them to `@Library`
     */
    readonly declarations: string
    /**
     * What was generated, and what was left out
     */
    readonly report: GenerationReport
}

/**
 * The tokens that are not names of types or constants
 */
const KEYWORDS: ReadonlySet<string> = new Set(['struct', 'union', 'enum', 'typedef', 'extern', 'static', 'const', 'volatile', 'signed', 'unsigned', 'inline'])

/**
 * The names the generated file imports or uses: not names of interfaces
 */
const TAKEN: ReadonlySet<string> = new Set(['Library', 'Native', 'NativeLibrary', 'NativeVariable', 'Pointer', 'Out', 'Buffer', 'ArrayBufferView', 'Array', 'Object', 'Function', 'String', 'Number', 'Date', 'Error', 'Map', 'Set', 'Promise'])

/**
 * The options of the configuration of the component of a library: not names of properties
 */
const CONFIGURATION: readonly string[] = ['path', 'search', 'keepLoaded', 'drainTimeout', 'threads']

/**
 * The names of the members of a NativeLibrary: a function named as one of them gets another property
 */
function memberNames(): Set<string> {
    const names: Set<string> = new Set(CONFIGURATION)
    for (let prototype: object | null = NativeLibrary.prototype; prototype && prototype !== Object.prototype; prototype = Object.getPrototypeOf(prototype)) {
        for (const name of Object.getOwnPropertyNames(prototype)) names.add(name)
    }
    return names
}

/**
 * A path as the paths of the line markers are compared (case-insensitive on Windows)
 * @param file
 */
function comparable(file: string): string {
    const resolved: string = path.resolve(file)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/**
 * Whether a file is inside a directory
 * @param file
 * @param directory
 */
function inside(file: string, directory: string): boolean {
    const relative: string = path.relative(directory, file)
    return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative)
}

/**
 * Which files are the ones of the library: the header, the headers of its directory when it is not a directory of the
 * system, the ones of the directories given
 * @param header
 * @param systemDirectories
 * @param own
 */
function ownFiles(header: string, systemDirectories: readonly string[], own: readonly string[]): (file: string | undefined) => boolean {
    const main: string = comparable(header)
    const system: string[] = systemDirectories.map(comparable)
    const directory: string = path.dirname(main)
    const directories: string[] = [...system.includes(directory) ? [] : [directory], ...own.map(comparable)]
    const known: Map<string, boolean> = new Map()
    return (file: string | undefined): boolean => {
        if (!file || file.startsWith('<')) return false
        let result: boolean | undefined = known.get(file)
        if (result === undefined) {
            const candidate: string = comparable(file)
            result = candidate === main || directories.some((dir: string): boolean => inside(candidate, dir) && !system.some((sys: string): boolean => sys !== dir && inside(candidate, sys) && inside(sys, dir)))
            known.set(file, result)
        }
        return result
    }
}

/**
 * The names a declaration uses: of types (\`type x\`, \`struct x\`) and of constants
 * @param tokens
 */
function referencesOf(tokens: readonly Token[]): string[] {
    const references: string[] = []
    tokens.forEach((token: Token, index: number): void => {
        if (token.kind !== 'identifier' || KEYWORDS.has(token.text)) return
        const before: Token | undefined = tokens[index - 1]
        if (before?.kind === 'identifier' && (before.text === 'struct' || before.text === 'union' || before.text === 'enum')) references.push(`${before.text} ${token.text}`)
        else references.push(`type ${token.text}`, `constant ${token.text}`)
    })
    return references
}

/**
 * A name in PascalCase (\`sqlite3\`: \`Sqlite3\`, \`vendor_sdk\`: \`VendorSdk\`)
 * @param name
 */
function pascalCase(name: string): string {
    const words: string[] = name.split(/[^A-Za-z0-9]+/).filter(Boolean)
    const joined: string = words.map((word: string): string => word[0].toUpperCase() + word.slice(1)).join('') || 'Library'
    return /^[0-9]/.test(joined) ? `Library${joined}` : joined
}

/**
 * The name \`@Library\` gets for a library given as a name or a file: \`libsqlite3.dylib\`, \`libsqlite3.so\`, \`sqlite3.dll\`
 * give \`sqlite3\` (completed on each platform); a file with a version is kept as it is
 * @param library
 */
function libraryName(library: string): string {
    const file: string = path.basename(library)
    const plain: RegExpMatchArray | null = file.match(/^(?:lib)?(.+?)\.(?:dylib|so|dll)$/i)
    if (plain && !/\.(?:dylib|so|dll)/i.test(plain[1])) return plain[1]
    return file
}

/**
 * A text as the lines of a comment of TypeScript, wrapped at 120 characters
 * @param text
 */
function commentLines(text: string): string[] {
    const lines: string[] = []
    let line: string = '//'
    for (const word of text.split(' ')) {
        if (line.length > 2 && line.length + 1 + word.length > 120) {
            lines.push(line)
            line = '//'
        }
        line += line.length > 2 ? ` ${word}` : word
    }
    lines.push(line)
    return lines
}

/**
 * Text put in a template literal of TypeScript
 * @param text
 */
function templateText(text: string): string {
    return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
}

/**
 * The first line of the message of an error
 * @param error
 */
function reasonOf(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).split('\n')[0].replace(/ \(line \d+, column \d+\)$/, '')
}

/**
 * Generate the class of a library from a header already run through the preprocessor (see generateNativeLibrary).
 * @param preprocessed The output of the preprocessor, the header, the directories of the system.
 * @param options The library, the class, the directories of the library.
 * @param platform The platform the header was preprocessed for.
 * @returns The code of the class and the report.
 */
export async function generateFromPreprocessed(preprocessed: PreprocessedHeader, options: Omit<GenerateOptions, 'header'> = {}, platform: Platform = CURRENT_PLATFORM): Promise<GeneratedLibrary> {
    const header: string = preprocessed.header
    const headerName: string = path.basename(header).replace(/\.[^.]+$/, '')
    const source: SourceDeclarations = new DeclarationParser(platform).readSource(preprocessed.text)
    const items: readonly SourceDeclaration[] = source.items
    const isOwn: (file: string | undefined) => boolean = ownFiles(header, preprocessed.systemDirectories, options.own ?? [])
    const builtins: ReadonlyMap<string, CType> = builtinTypes(platform)
    const skipped: SkippedDeclaration[] = []
    const where = (item: SourceDeclaration): { file?: string, line?: number } => ({...item.file !== undefined ? {file: item.file} : {}, ...item.line !== undefined ? {line: item.line} : {}})
    //The declarations of the library, and the ones of the system they use
    const definers: Map<string, number[]> = new Map()
    items.forEach((item: SourceDeclaration, index: number): void => {
        if (item.error) return
        for (const name of item.names) definers.set(name, [...definers.get(name) ?? [], index])
    })
    const selected: Set<number> = new Set()
    const queue: number[] = []
    items.forEach((item: SourceDeclaration, index: number): void => {
        if (!isOwn(item.file)) return
        if (item.error) {
            skipped.push({name: declarationText(prunedTokens(item.tokens.slice(0, 16)), '').join(' ').slice(0, 80), ...where(item), reason: item.error})
            return
        }
        if (!item.names.length) return
        selected.add(index)
        queue.push(index)
    })
    while (queue.length) {
        const index: number = queue.pop()!
        const item: SourceDeclaration = items[index]
        for (const reference of referencesOf(item.tokens)) {
            if (item.names.includes(reference)) continue
            if (reference.startsWith('type ') && builtins.has(reference.slice(5))) continue
            //The definition seen at that point: the last one before it
            const candidates: number[] = definers.get(reference) ?? []
            const definer: number | undefined = candidates.filter((candidate: number): boolean => candidate < index).pop() ?? candidates[0]
            if (definer === undefined || selected.has(definer)) continue
            //A typedef of the system redefining a type the package knows is not needed
            if (!isOwn(items[definer].file) && items[definer].names.every((name: string): boolean => name.startsWith('type ') && builtins.has(name.slice(5)))) continue
            selected.add(definer)
            queue.push(definer)
        }
    }
    //The macros of the library whose value is an integer, written with their values
    const itemConstants: Set<string> = new Set(items.flatMap((item: SourceDeclaration): string[] => [...item.names]).filter((name: string): boolean => name.startsWith('constant ')).map((name: string): string => name.slice(9)))
    const macroConstants: [string, bigint][] = [...source.macros]
        .filter(([name, origin]: [string, MacroOrigin]): boolean => isOwn(origin.file) && source.declarations.constants.has(name) && !itemConstants.has(name))
        .map(([name]: [string, MacroOrigin]): [string, bigint] => [name, source.declarations.constants.get(name)!])
    //The declarations written again, each one checked: read alone, after the ones before it
    const checker: DeclarationParser = new DeclarationParser(platform)
    const chunks: { index: number, lines: string[] }[] = []
    for (const index of [...selected].sort((a: number, b: number): number => a - b)) {
        const item: SourceDeclaration = items[index]
        const body: string[] = declarationText(prunedTokens(item.tokens))
        const lines: string[] = item.pack !== undefined && item.names.some((name: string): boolean => name.startsWith('struct ') || name.startsWith('union ') || name.startsWith('type '))
            ? [`#pragma pack(push, ${item.pack})`, ...body, '#pragma pack(pop)']
            : body
        try {
            checker.parse(lines.join('\n'))
            chunks.push({index: index, lines: lines})
        } catch (error) {
            selected.delete(index)
            if (isOwn(item.file)) skipped.push({name: item.names.join(', '), ...where(item), reason: `its declaration cannot be read again: ${reasonOf(error)}`})
        }
    }
    const constantLines: string[] = macroConstants.map(([name, value]: [string, bigint]): string => `#define ${name} ${value}`)
    const declarations: string = [...chunks.flatMap((chunk): string[] => chunk.lines), ...constantLines].join('\n')
    //The functions and the variables of the library
    let functions: FunctionDeclaration[] = []
    let variables: VariableDeclaration[] = []
    const prototypes: Map<string, string> = new Map()
    for (const chunk of chunks) {
        const item: SourceDeclaration = items[chunk.index]
        if (!isOwn(item.file)) continue
        for (const name of item.names) {
            if (name.startsWith('function ')) {
                const fn: FunctionDeclaration | undefined = source.declarations.functions.get(name.slice(9))
                if (fn) functions.push(fn)
                prototypes.set(name.slice(9), declarationText(prunedTokens(item.tokens), '').join(' '))
            } else if (name.startsWith('variable ')) {
                const variable: VariableDeclaration | undefined = source.declarations.variables.get(name.slice(9))
                if (variable) variables.push(variable)
            }
        }
    }
    const ownConstants: number = macroConstants.length + chunks.filter((chunk): boolean => isOwn(items[chunk.index].file)).flatMap((chunk): readonly string[] => items[chunk.index].names).filter((name: string): boolean => name.startsWith('constant ')).length
    //Checked against the library: the functions and the variables it cannot give left out
    let libraryFile: string | undefined
    let unchecked: string | undefined
    const library: string = options.library ?? headerName
    if (options.check === false) {
        unchecked = 'not asked'
    } else {
        let handle: NativeLibraryHandle | undefined
        try {
            handle = loadNativeLibrary(library, declarations)
        } catch (error) {
            unchecked = reasonOf(error).replace(/:$/, '').replace(/^The /, 'the ')
        }
        if (handle) {
            libraryFile = handle.file
            const usable = <T extends { name: string }>(declared: T[], bind: (name: string) => unknown): T[] => declared.filter((declaration: T): boolean => {
                try {
                    bind(declaration.name)
                    return true
                } catch (error) {
                    skipped.push({name: declaration.name, reason: reasonOf(error)})
                    return false
                }
            })
            functions = usable(functions, (name: string): unknown => handle.function(name))
            variables = usable(variables, (name: string): unknown => handle.variable(name))
            await handle.close()
        }
    }
    //The interfaces of the structs and unions of the library
    const records: { name: string, record: RecordType }[] = []
    const names: Map<CType, string> = new Map()
    const used: Set<string> = new Set([...TAKEN])
    const className: string = options.className ?? pascalCase(headerName)
    used.add(className)
    const nameRecord = (record: RecordType, preferred: string): void => {
        if (names.has(record)) return
        let name: string = preferred
        while (used.has(name)) name = `${name}_`
        used.add(name)
        names.set(record, name)
        records.push({name: name, record: record})
    }
    for (const chunk of chunks) {
        const item: SourceDeclaration = items[chunk.index]
        if (!isOwn(item.file)) continue
        for (const name of item.names) {
            const type: CType | undefined = name.startsWith('type ') ? source.declarations.types.get(name.slice(5)) : name.startsWith('struct ') || name.startsWith('union ') ? source.declarations.tags.get(name) : undefined
            if ((type?.kind === 'struct' || type?.kind === 'union') && type.members) nameRecord(type, name.startsWith('type ') ? name.slice(5) : name.split(' ')[1])
        }
    }
    const types: TypeScriptTypes = new TypeScriptTypes(names)
    //The class: a property by function and variable, named as it (another name when the component has a member of that name)
    const reserved: Set<string> = memberNames()
    const property = (name: string): { name: string, argument: string } => {
        if (!reserved.has(name)) return {name: name, argument: ''}
        let renamed: string = `${name}_`
        while (reserved.has(renamed)) renamed = `${renamed}_`
        return {name: renamed, argument: `'${name}'`}
    }
    const members: string[] = []
    for (const fn of functions) {
        const prototype: string | undefined = prototypes.get(fn.name)
        const {name, argument} = property(fn.name)
        members.push([...prototype ? [`    //${prototype}`] : [], `    @Native(${argument})`, `    public readonly ${name}: ${types.functionType(fn.type)}`].join('\n'))
    }
    for (const variable of variables) {
        const {name, argument} = property(variable.name)
        members.push([`    @NativeVariable(${argument})`, `    public readonly ${name}: ${types.type(variable.type, 'received')}`].join('\n'))
    }
    const interfaces: string[] = records.map(({name, record}: { name: string, record: RecordType }): string => [`export interface ${name} {`, ...types.members(record, '    '), '}'].join('\n'))
    const body: string = [...interfaces, ...members].join('\n')
    const imports: string[] = ['Library', 'Native', 'NativeLibrary', ...variables.length ? ['NativeVariable'] : [], ...body.includes('Out<') ? ['type Out'] : [], ...body.includes('Pointer') ? ['type Pointer'] : []]
    const platformName: string = `${platform.os}-${platform.arch}`
    const code: string = [
        ...commentLines(`Generated from ${path.basename(header)} by the generator of @lakutata/ffi (lakutata ffi generate), for ${platformName}${libraryFile ? `; checked against ${libraryFile}` : ''}: ${functions.length} functions, ${variables.length} variables, ${ownConstants} constants.`),
        ...commentLines('The functions are synchronous, and their pointer parameters are inputs: where needed, mark the output parameters _Out_ in the declarations and the functions that block {async: true} (see the guide of @lakutata/ffi). Another build of the library may lack some of these functions: the component then refuses to start, naming the function.'),
        `import {${imports.join(', ')}} from '@lakutata/ffi'`,
        '',
        ...interfaces.flatMap((text: string): string[] => [text, '']),
        '@Library({',
        `    names: ${JSON.stringify(libraryName(library)).replace(/^"|"$/g, '\'')},`,
        '    declarations: `',
        ...templateText(declarations).split('\n').map((line: string): string => `        ${line}`),
        '    `',
        '})',
        `export class ${className} extends NativeLibrary {`,
        members.join('\n\n'),
        '}',
        ''
    ].join('\n')
    return {
        className: className,
        code: code,
        declarations: declarations,
        report: {
            command: preprocessed.command,
            platform: platformName,
            ...libraryFile ? {library: libraryFile} : {},
            ...unchecked ? {unchecked: unchecked} : {},
            functions: functions.length,
            variables: variables.length,
            interfaces: records.length,
            constants: ownConstants,
            skipped: skipped
        }
    }
}

/**
 * Generate the class of a native library from its header: the header is run through the preprocessor of the C compiler,
 * its declarations are read, the functions and the variables the library cannot give are left out, and the class gets a
 * property by function (named as the function) with its TypeScript type.
 * @param options The header, the library, the class, the compiler and its options.
 * @returns The code of the class, and what was generated and left out.
 * @example
 * ```typescript
 * import {writeFileSync} from 'node:fs'
 * import {generateNativeLibrary} from '@lakutata/ffi/generator'
 *
 * const {code, report} = await generateNativeLibrary({header: 'vendor/include/vendor.h', library: 'vendor/lib/libvendor.so'})
 * writeFileSync('src/native/Vendor.ts', code)
 * for (const skipped of report.skipped) console.log(`${skipped.name}: ${skipped.reason}`)
 * ```
 */
export async function generateNativeLibrary(options: GenerateOptions): Promise<GeneratedLibrary> {
    return await generateFromPreprocessed(preprocessHeader(options), options)
}
