import {readdirSync, realpathSync, statSync, type Dirent} from 'node:fs'
import {readdir, realpath, stat} from 'node:fs/promises'
import path from 'node:path'
import {CompileSegment, ExpandBraces, type GlobSegment} from './internal/GlobPattern.js'

/**
 * The options of {@link Glob} and {@link GlobSync}.
 */
export interface GlobOptions {
    /**
     * The directory the relative patterns are resolved from and the relative results are relative to; a relative `cwd`
     * is resolved from the current directory.
     * @default process.cwd()
     */
    cwd?: string
    /**
     * Give absolute paths. When `false`, the results of a relative pattern are relative to `cwd`, and the results of an
     * absolute pattern are absolute.
     * @default false
     */
    absolute?: boolean
    /**
     * Let the wildcards (`*`, `**`, `?`, `[...]`) match the names starting with a dot. A pattern segment starting with
     * a dot (`.config/*`) matches them anyway.
     * @default false
     */
    dot?: boolean
    /**
     * Give the files only (and the other entries which are not directories), not the directories.
     * @default false
     */
    nodir?: boolean
    /**
     * Follow the symbolic links to directories while expanding `**`; a link not followed is still matched by a trailing
     * `**`. The links named by the other segments are always followed, and a link cycle is walked once.
     * @default false
     */
    follow?: boolean
    /**
     * The patterns of the paths to exclude from the results, matched against the paths relative to `cwd` with `/`
     * separators (a leading `./` is dropped). They match the names starting with a dot, and `dir/**` excludes `dir`
     * and everything under it. Excluded directories are still walked.
     * @default none
     */
    ignore?: string | string[]
    /**
     * Match the names case-insensitively.
     * @default true on macOS and Windows (whose file systems usually are case-insensitive), false elsewhere
     */
    nocase?: boolean
}

/**
 * A request of the walk to the file system, answered by the synchronous or the asynchronous driver
 */
type FileSystemRequest =
    | { readonly type: 'readdir', readonly path: string }
    | { readonly type: 'stat', readonly path: string }
    | { readonly type: 'realpath', readonly path: string }

/**
 * An entry of a directory
 */
interface Entry {
    readonly name: string
    readonly directory: boolean
    readonly link: boolean
}

type Walk = Generator<FileSystemRequest, void, unknown>

/**
 * A compiled pattern
 */
interface CompiledPattern {
    //The directory of the walk (the names at the start of the pattern resolved)
    readonly base: string
    //The path of the base in the results
    readonly prefix: string
    readonly segments: GlobSegment[]
    //A pattern ending with "/" matches the directories only
    readonly directoryOnly: boolean
}

/**
 * The options with their defaults
 */
interface Settings {
    readonly cwd: string
    readonly absolute: boolean
    readonly dot: boolean
    readonly nodir: boolean
    readonly follow: boolean
    readonly nocase: boolean
    readonly ignore: RegExp[]
}

/**
 * Join a relative path of the results
 * @param prefix
 * @param name
 */
function JoinRelative(prefix: string, name: string): string {
    return prefix ? JoinName(prefix, name) : name
}

/**
 * Join the name of an entry to the path of its directory: a name read from a directory has no separator nor "..",
 * so the path stays normalized without path.join()
 * @param directory
 * @param name
 */
function JoinName(directory: string, name: string): string {
    return directory.endsWith(path.sep) ? directory + name : directory + path.sep + name
}

/**
 * Compile a pattern (its braces expanded)
 * @param pattern
 * @param settings
 */
function CompilePattern(pattern: string, settings: Settings): CompiledPattern {
    const absolute: boolean = path.isAbsolute(pattern)
    const root: string = absolute ? path.parse(pattern).root : ''
    const rest: string = pattern.substring(root.length)
    const parts: string[] = rest.split('/')
    const directoryOnly: boolean = parts.length > 1 && parts[parts.length - 1] === ''
    const names: string[] = parts.filter((part: string, index: number): boolean => part !== '' || index === 0 && parts.length === 1)
    const segments: GlobSegment[] = names.map((name: string): GlobSegment => CompileSegment(name, settings.nocase))
    //The names at the start are resolved (with "." and ".."), the walk starts after them
    let base: string = absolute ? root : settings.cwd
    let prefix: string = absolute ? root : ''
    while (segments.length > 1 && segments[0].type === 'name') {
        const name: string = (segments.shift() as { name: string }).name
        base = path.join(base, name)
        prefix = absolute || prefix ? path.join(prefix, name) : name
    }
    return {base: base, prefix: prefix, segments: segments, directoryOnly: directoryOnly}
}

/**
 * The regular expressions of an ignored pattern (its braces expanded), on the paths relative to cwd ("/" separated);
 * the ignored patterns match the names starting with a dot
 * @param pattern
 * @param nocase
 */
function CompileIgnore(pattern: string, nocase: boolean): RegExp[] {
    const GLOBSTAR: string = '\u0000'
    return ExpandBraces(pattern.replace(/^\.\//, '')).map((expanded: string): RegExp => {
        const source: string = expanded.split('/').filter((part: string): boolean => part !== '').map((part: string): string => {
            if (part === '**') return GLOBSTAR
            const segment: GlobSegment = CompileSegment(part, false)
            return segment.type === 'pattern' ? segment.regex.source.slice(1, -1) : segment.type === 'name' ? segment.name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') : GLOBSTAR
        }).join('/')
            //"**" is zero or more directories: alone, at the start, between two segments, at the end (with the directory)
            .replace(new RegExp(`^${GLOBSTAR}$`), '.*')
            .replace(new RegExp(`^${GLOBSTAR}/`), '(?:.*/)?')
            .replace(new RegExp(`/${GLOBSTAR}/`, 'g'), '(?:/.*)?/')
            .replace(new RegExp(`/${GLOBSTAR}$`), '(?:/.*)?')
        return new RegExp(`^${source}$`, nocase ? 'i' : '')
    })
}

/**
 * Walk the file system matching a pattern
 * @param pattern
 * @param settings
 * @param emit receives the path of each match and whether it is a directory
 */
function* WalkPattern(pattern: CompiledPattern, settings: Settings, emit: (relative: string, absolute: string, directory: boolean) => void): Walk {
    /**
     * The entries of a directory (empty when it cannot be read)
     * @param directory
     */
    function* entriesOf(directory: string): Generator<FileSystemRequest, Entry[], unknown> {
        const dirents: Dirent[] | null = (yield {type: 'readdir', path: directory}) as Dirent[] | null
        if (!dirents) return []
        const entries: Entry[] = []
        for (const dirent of dirents) {
            const link: boolean = dirent.isSymbolicLink()
            let isDirectory: boolean = dirent.isDirectory()
            if (link) {
                const target: { isDirectory(): boolean } | null = (yield {type: 'stat', path: JoinName(directory, dirent.name)}) as { isDirectory(): boolean } | null
                isDirectory = !!target && target.isDirectory()
            }
            entries.push({name: dirent.name, directory: isDirectory, link: link})
        }
        return entries
    }

    /**
     * Whether a name may be matched by a wildcard
     * @param name
     * @param dot whether the segment starts with a dot
     */
    const visible = (name: string, dot: boolean): boolean => name[0] !== '.' || settings.dot || dot

    //The real paths of the directories walked by the globstars, against the cycles of the links
    const visited: Set<string> = new Set()

    /**
     * The real path of a directory: only a link needs to be resolved
     * @param entry
     * @param child
     * @param real the real path of its directory
     */
    function* realOf(entry: Entry, child: string, real: string): Generator<FileSystemRequest, string | null, unknown> {
        if (!entry.link) return JoinName(real, entry.name)
        return (yield {type: 'realpath', path: child}) as string | null
    }

    /**
     * Match the segments from an index in a directory
     * @param directory
     * @param relative its path in the results
     * @param real its real path
     * @param index
     * @param given the entries of the directory, when they are read already
     */
    function* step(directory: string, relative: string, real: string, index: number, given?: Entry[]): Walk {
        const segment: GlobSegment | undefined = pattern.segments[index]
        if (!segment) {
            emit(relative, directory, true)
            return
        }
        const last: boolean = index === pattern.segments.length - 1
        if (segment.type === 'globstar') {
            const entries: Entry[] = given ?? (yield* entriesOf(directory))
            //Zero directory (the entries are read once for both cases)
            if (last) {
                emit(relative, directory, true)
            } else {
                yield* step(directory, relative, real, index + 1, entries)
            }
            //One more directory
            for (const entry of entries) {
                if (!visible(entry.name, false)) continue
                const child: string = JoinName(directory, entry.name)
                const childRelative: string = JoinRelative(relative, entry.name)
                if (!entry.directory) {
                    if (last) emit(childRelative, child, false)
                    continue
                }
                if (entry.link && !settings.follow) {
                    //A link not followed is a match of a trailing globstar
                    if (last) emit(childRelative, child, true)
                    continue
                }
                const childReal: string | null = yield* realOf(entry, child, real)
                if (!childReal || visited.has(childReal)) continue
                visited.add(childReal)
                yield* step(child, childRelative, childReal, index)
                visited.delete(childReal)
            }
            return
        }
        const candidates: Entry[] = []
        if (segment.type === 'name' && (segment.name === '.' || segment.name === '..')) {
            candidates.push({name: segment.name, directory: true, link: false})
        } else if (segment.type === 'name' && !settings.nocase && !given) {
            const target: { isDirectory(): boolean } | null = (yield {type: 'stat', path: path.join(directory, segment.name)}) as { isDirectory(): boolean } | null
            if (target) candidates.push({name: segment.name, directory: target.isDirectory(), link: false})
        } else {
            const nameMatch: string | undefined = segment.type === 'name' ? (settings.nocase ? segment.name.toLowerCase() : segment.name) : undefined
            for (const entry of given ?? (yield* entriesOf(directory))) {
                const matches: boolean = segment.type === 'name'
                    ? (settings.nocase ? entry.name.toLowerCase() : entry.name) === nameMatch
                    : visible(entry.name, segment.dot) && segment.regex.test(entry.name)
                if (matches) candidates.push(entry)
            }
        }
        for (const candidate of candidates) {
            //"." and ".." are resolved, the names read from the directory are joined as they are
            const special: boolean = candidate.name === '.' || candidate.name === '..'
            const child: string = special ? path.join(directory, candidate.name) : JoinName(directory, candidate.name)
            const childRelative: string = special ? (relative ? path.join(relative, candidate.name) : candidate.name) : JoinRelative(relative, candidate.name)
            if (last) {
                emit(childRelative, child, candidate.directory)
            } else if (candidate.directory) {
                const childReal: string | null = yield* realOf(candidate, child, real)
                if (childReal) yield* step(child, childRelative, childReal, index + 1)
            }
        }
    }

    //The base itself (a pattern of names only)
    if (!pattern.segments.length) {
        const target: { isDirectory(): boolean } | null = (yield {type: 'stat', path: pattern.base}) as { isDirectory(): boolean } | null
        if (target) emit(pattern.prefix, pattern.base, target.isDirectory())
        return
    }
    const real: string | null = (yield {type: 'realpath', path: pattern.base}) as string | null
    if (!real) return
    visited.add(real)
    yield* step(pattern.base, pattern.prefix, real, 0)
}

/**
 * The settings of the options
 * @param options
 */
function Configure(options: GlobOptions): Settings {
    const nocase: boolean = options.nocase ?? (process.platform === 'darwin' || process.platform === 'win32')
    const ignore: string[] = options.ignore === undefined ? [] : Array.isArray(options.ignore) ? options.ignore : [options.ignore]
    return {
        cwd: path.resolve(options.cwd ?? process.cwd()),
        absolute: options.absolute ?? false,
        dot: options.dot ?? false,
        nodir: options.nodir ?? false,
        follow: options.follow ?? false,
        nocase: nocase,
        ignore: ignore.flatMap((pattern: string): RegExp[] => CompileIgnore(pattern, nocase))
    }
}

/**
 * The walks of the patterns, and the results they collect
 * @param patterns
 * @param options
 */
function Prepare(patterns: string | string[], options: GlobOptions): { walks: Walk[], results: () => string[] } {
    const settings: Settings = Configure(options)
    const found: Map<string, string> = new Map()
    const walks: Walk[] = []
    for (const pattern of Array.isArray(patterns) ? patterns : [patterns]) {
        for (const expanded of ExpandBraces(pattern)) {
            const compiled: CompiledPattern = CompilePattern(expanded, settings)
            const absolutePattern: boolean = path.isAbsolute(expanded)
            walks.push(WalkPattern(compiled, settings, (relative: string, absolute: string, directory: boolean): void => {
                if (settings.nodir && directory) return
                if (compiled.directoryOnly && !directory) return
                if (settings.ignore.length) {
                    const fromCwd: string = path.relative(settings.cwd, absolute).split(path.sep).join('/') || '.'
                    if (settings.ignore.some((ignored: RegExp): boolean => ignored.test(fromCwd))) return
                }
                //The paths are joined, so normalized: the absolute path identifies a match
                found.set(absolute, settings.absolute || absolutePattern ? absolute : (relative || '.'))
            }))
        }
    }
    return {walks: walks, results: (): string[] => [...new Set(found.values())].sort()}
}

/**
 * Answer a request synchronously
 * @param request
 */
function AnswerSync(request: FileSystemRequest): unknown {
    try {
        switch (request.type) {
            case 'readdir':
                return readdirSync(request.path, {withFileTypes: true})
            case 'stat':
                return statSync(request.path)
            case 'realpath':
                return realpathSync(request.path)
        }
    } catch {
        return null
    }
}

/**
 * Answer a request asynchronously
 * @param request
 */
async function AnswerAsync(request: FileSystemRequest): Promise<unknown> {
    try {
        switch (request.type) {
            case 'readdir':
                return await readdir(request.path, {withFileTypes: true})
            case 'stat':
                return await stat(request.path)
            case 'realpath':
                return await realpath(request.path)
        }
    } catch {
        return null
    }
}

/**
 * Find the files and directories matching glob patterns. A pattern is made of segments separated by `/` on every
 * platform (`\` is not a separator, it escapes the next character), with: `*` (any characters in a name), `**` alone
 * in a segment (zero or more directories), `?` (one character), `[...]` (one of the characters, `[!...]` one not
 * listed), `{a,b}` (alternatives) and `{1..3}` (ranges). A pattern ending with `/` matches the directories only; a
 * pattern without wildcard gives its path when it exists. The names starting with a dot are only matched as
 * `options.dot` says.
 *
 * The unreadable directories and the broken links are skipped silently: a pattern matching nothing gives `[]`, it
 * never rejects for a path missing.
 * @param pattern A pattern or several (their results are merged), relative to `options.cwd` or absolute; an empty
 * array gives `[]`.
 * @param options How the paths are matched and given, see {@link GlobOptions}.
 * @returns A promise of the matching paths, sorted, without duplicates, normalized with the separators of the platform
 * (`./src/*.ts` gives `src/a.ts`); `**` alone includes `.`, the base directory itself.
 * @example
 * ```typescript
 * import {Glob} from 'lakutata/utils'
 *
 * //The TypeScript sources, without the tests
 * const sources: string[] = await Glob('src/**\/*.ts', {ignore: 'src/tests/**'})
 * console.log(sources)
 * //['src/index.ts', 'src/lib/a.ts']
 * ```
 */
export async function Glob(pattern: string | string[], options: GlobOptions = {}): Promise<string[]> {
    const {walks, results} = Prepare(pattern, options)
    for (const walk of walks) {
        let answer: unknown
        for (let request: IteratorResult<FileSystemRequest, void> = walk.next(); !request.done; request = walk.next(answer)) answer = await AnswerAsync(request.value)
    }
    return results()
}

/**
 * Find the files and directories matching glob patterns synchronously, blocking the event loop while the file system
 * is walked: the same patterns, options and results as {@link Glob}, for the startup code and the scripts.
 * @param pattern A pattern or several (their results are merged), relative to `options.cwd` or absolute; an empty
 * array gives `[]`.
 * @param options How the paths are matched and given, see {@link GlobOptions}.
 * @returns The matching paths, sorted, without duplicates; `[]` when nothing matches.
 * @example
 * ```typescript
 * import path from 'node:path'
 * import {GlobSync} from 'lakutata/utils'
 *
 * //The absolute paths of the JSON files of a directory, its hidden ones included
 * const configs: string[] = GlobSync('*.json', {cwd: path.resolve('config'), absolute: true, dot: true})
 * console.log(configs)
 * //['/srv/app/config/.local.json', '/srv/app/config/default.json']
 * ```
 */
export function GlobSync(pattern: string | string[], options: GlobOptions = {}): string[] {
    const {walks, results} = Prepare(pattern, options)
    for (const walk of walks) {
        let answer: unknown
        for (let request: IteratorResult<FileSystemRequest, void> = walk.next(); !request.done; request = walk.next(answer)) answer = AnswerSync(request.value)
    }
    return results()
}
