import {createHash} from 'node:crypto'
import {existsSync, readdirSync, realpathSync, statSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {parse} from 'acorn'

/**
 * The directory of the files the application reads by their paths in the native tree: the scripts it runs on their own
 * (bundled), the other files and the directories of data (copied), their directories as in the project
 */
export const FILES_DIRECTORY: string = '.lakutata/files'

/**
 * A piece of a path to a script: a text, or an expression known at run time only (the source of the expression)
 */
type Part = { text: string } | { expression: string }

/**
 * A path to a script given from a module: from its directory (path.join, path.resolve, a concatenation or a template of
 * __dirname), a URL relative to its file (new URL('./x.js', import.meta.url)), a URL text from its file
 * (import.meta.url + '/../x.js'), or a file resolved when the application is bundled (require.resolve)
 */
type ScriptPath = {
    /**
     * What the expression gives: a path, a URL, the text of a URL
     */
    kind: 'path' | 'url' | 'url-text'
    parts: Part[]
    /**
     * The path the parts are joined to, the directory of the module by default
     */
    base?: string
}

/**
 * The scripts run on their own: the CommonJS scripts, which they are bundled as
 */
const SCRIPT: RegExp = /\.c?js$/

/**
 * The code a directory of data must not hold: the scripts, which need their packages, and the packages
 */
const CODE: RegExp = /\.(c|m)?js$|^package\.json$|^node_modules$/

/**
 * The packages sharing the framework and holding addons, bundled with the application: the package of a file, the
 * native files of one of its directories (shipped by the paths to its own directories)
 */
export type AddonPackages = {
    packageOf(file: string): string | undefined
    nativeFilesOf(root: string, directory: string): string[]
}

/**
 * What a path from a module gives: the directory of its pattern, the parts from it, the scripts to bundle and the files
 * to copy (the files of its directories of data), or why it cannot be shipped
 */
type Targets = {
    directory: string
    rest: Part[]
    scripts: string[]
    files: string[]
    /**
     * The files and the directories it names (the roots of the files)
     */
    roots: string[]
    refused?: 'ancestor' | 'code'
}

/**
 * The files of a directory, deep
 * @param directory
 */
function filesOf(directory: string): string[] {
    const files: string[] = []
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
        const at: string = path.join(directory, entry.name)
        if (entry.isDirectory()) files.push(...filesOf(at))
        else if (entry.isFile()) files.push(at)
    }
    return files
}

/**
 * Whether a directory holds code: scripts, packages
 * @param directory
 */
function holdsCode(directory: string): boolean {
    return readdirSync(directory, {withFileTypes: true}).some((entry): boolean => CODE.test(entry.name) || (entry.isDirectory() && holdsCode(path.join(directory, entry.name))))
}

/**
 * The modules of the worker threads
 */
const WORKER_THREADS: Set<string> = new Set(['worker_threads', 'node:worker_threads'])

/**
 * The name of a function called: the identifier, the property (path.join, node_path_1.join), the last expression of a
 * sequence (the calls of tsc: (0, node_path_1.join)(...))
 * @param node
 */
function calleeName(node: any): string | undefined {
    if (node?.type === 'Identifier') return node.name
    if (node?.type === 'MemberExpression') return node.computed ? (typeof node.property.value === 'string' ? node.property.value : undefined) : node.property.name
    if (node?.type === 'SequenceExpression') return calleeName(node.expressions[node.expressions.length - 1])
    return undefined
}

/**
 * Whether a node is import.meta.<name>
 * @param node
 * @param name
 */
function isImportMeta(node: any, name: string): boolean {
    return node?.type === 'MemberExpression' && !node.computed && node.object.type === 'MetaProperty' && node.object.meta.name === 'import' && node.property.name === name
}

/**
 * Whether a node is the URL of the file of the module: import.meta.url, pathToFileURL(__filename) (and its href)
 * @param node
 */
function isFileURL(node: any): boolean {
    if (isImportMeta(node, 'url')) return true
    if (node?.type === 'CallExpression' && calleeName(node.callee) === 'pathToFileURL') return isFilename(node.arguments[0])
    if (node?.type === 'MemberExpression' && !node.computed && node.property.name === 'href') return isFileURL(node.object)
    return false
}

/**
 * Whether a node is the file of the module: __filename, import.meta.filename, fileURLToPath(import.meta.url)
 * @param node
 */
function isFilename(node: any): boolean {
    if (node?.type === 'Identifier') return node.name === '__filename'
    if (isImportMeta(node, 'filename')) return true
    return node?.type === 'CallExpression' && calleeName(node.callee) === 'fileURLToPath' && isImportMeta(node.arguments[0], 'url')
}

/**
 * Whether a node is the directory of the module: __dirname, import.meta.dirname, dirname(<its file>),
 * fileURLToPath(new URL('.', <its URL>))
 * @param node
 */
function isDirname(node: any): boolean {
    if (node?.type === 'Identifier') return node.name === '__dirname'
    if (isImportMeta(node, 'dirname')) return true
    if (node?.type !== 'CallExpression') return false
    const name: string | undefined = calleeName(node.callee)
    if (name === 'dirname') return isFilename(node.arguments[0])
    if (name !== 'fileURLToPath') return false
    const url: any = node.arguments[0]
    return url?.type === 'NewExpression' && calleeName(url.callee) === 'URL' && url.arguments[0]?.type === 'Literal' && ['.', './'].includes(url.arguments[0].value) && isFileURL(url.arguments[1])
}

/**
 * Whether a node is require('<module>') of one of the modules
 * @param node
 * @param modules
 */
function isRequireOf(node: any, modules: Set<string>): boolean {
    return node?.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments[0]?.type === 'Literal' && modules.has(node.arguments[0].value)
}

/**
 * The pieces of a string expression: its literal texts, the expressions known at run time only
 * @param node
 * @param source
 */
function partsOf(node: any, source: string): Part[] | undefined {
    if (node?.type === 'Literal') return typeof node.value === 'string' ? [{text: node.value}] : undefined
    if (node?.type === 'TemplateLiteral') {
        const parts: Part[] = []
        node.quasis.forEach((quasi: any, index: number): void => {
            if (quasi.value.cooked) parts.push({text: quasi.value.cooked})
            if (index < node.expressions.length) parts.push({expression: source.slice(node.expressions[index].start, node.expressions[index].end)})
        })
        return parts
    }
    if (node?.type === 'BinaryExpression' && node.operator === '+') {
        const left: Part[] | undefined = partsOf(node.left, source)
        const right: Part[] | undefined = partsOf(node.right, source)
        return left && right ? [...left, ...right] : undefined
    }
    if (node?.type === 'SpreadElement') return undefined
    return [{expression: source.slice(node.start, node.end)}]
}

/**
 * The operands of a chain of concatenations, from the first one
 * @param node
 */
function operandsOf(node: any): any[] {
    return node?.type === 'BinaryExpression' && node.operator === '+' ? [...operandsOf(node.left), node.right] : [node]
}

/**
 * The parts of the operands following a base
 * @param operands
 * @param source
 */
function partsOfOperands(operands: any[], source: string): Part[] | undefined {
    const parts: Part[] = []
    for (const operand of operands) {
        const pieces: Part[] | undefined = partsOf(operand, source)
        if (!pieces) return undefined
        parts.push(...pieces)
    }
    return parts
}

/**
 * The text of parts known when the application is bundled, undefined when one is known at run time only
 * @param parts
 */
function textOf(parts: Part[]): string | undefined {
    return parts.every((part: Part): boolean => 'text' in part) ? parts.map((part: Part): string => (part as { text: string }).text).join('') : undefined
}

/**
 * The path to a script an expression gives from its module, undefined when it gives none
 * @param node
 * @param source
 * @param file the module
 */
function scriptPathOf(node: any, source: string, file: string): ScriptPath | undefined {
    //new URL('./worker.js', import.meta.url), new URL('./worker.js', pathToFileURL(__filename))
    if (node?.type === 'NewExpression' && calleeName(node.callee) === 'URL' && node.arguments.length === 2 && isFileURL(node.arguments[1])) {
        const parts: Part[] | undefined = partsOf(node.arguments[0], source)
        const first: Part | undefined = parts?.[0]
        //A path relative to the module
        if (!parts || !first || !('text' in first) || /^([a-z][a-z0-9+.-]*:|\/)/i.test(first.text)) return undefined
        return {kind: 'url', parts: parts}
    }
    if (node?.type === 'CallExpression') {
        const name: string | undefined = calleeName(node.callee)
        //path.join(__dirname, 'worker.js'), path.resolve(__dirname, 'workers', `${name}.js`)
        if ((name === 'join' || name === 'resolve') && isDirname(node.arguments[0])) {
            const parts: Part[] = []
            for (const argument of node.arguments.slice(1)) {
                const pieces: Part[] | undefined = partsOf(argument, source)
                if (!pieces) return undefined
                parts.push({text: '/'}, ...pieces)
            }
            return {kind: 'path', parts: parts}
        }
        //require.resolve('./worker'), require.resolve(path.resolve(__dirname, '../lib/worker')): the extension of node found
        if (name === 'resolve' && node.callee.type === 'MemberExpression' && node.callee.object.type === 'Identifier' && node.callee.object.name === 'require' && node.arguments.length === 1) {
            const argument: any = node.arguments[0]
            let request: string | undefined
            if (argument.type === 'Literal' && typeof argument.value === 'string' && /^\.\.?\//.test(argument.value)) request = argument.value
            const inner: ScriptPath | undefined = request === undefined ? scriptPathOf(argument, source, file) : undefined
            const text: string | undefined = inner?.kind === 'path' ? textOf(inner.parts) : undefined
            if (text !== undefined) request = path.join(inner!.base ?? path.dirname(file), text)
            if (request === undefined) return undefined
            try {
                const resolved: string = createRequire(file).resolve(request)
                return {kind: 'path', parts: [{text: path.basename(resolved)}], base: path.dirname(resolved)}
            } catch {
                return undefined
            }
        }
    }
    if (node?.type === 'BinaryExpression' && node.operator === '+') {
        const [base, ...rest] = operandsOf(node)
        //__dirname + '/worker.js'
        if (isDirname(base)) {
            const parts: Part[] | undefined = partsOfOperands(rest, source)
            return parts ? {kind: 'path', parts: parts} : undefined
        }
        //import.meta.url + '/../entry/worker.js': the URL of the module, as a directory
        if (isFileURL(base)) {
            const parts: Part[] | undefined = partsOfOperands(rest, source)
            const first: Part | undefined = parts?.[0]
            return parts && first && 'text' in first && first.text.startsWith('/') ? {kind: 'url-text', parts: parts, base: file} : undefined
        }
        return undefined
    }
    //`${__dirname}/worker.js`
    if (node?.type === 'TemplateLiteral' && node.expressions.length && !node.quasis[0].value.cooked && isDirname(node.expressions[0])) {
        const parts: Part[] = []
        node.quasis.forEach((quasi: any, index: number): void => {
            if (quasi.value.cooked) parts.push({text: quasi.value.cooked})
            if (index > 0 && index < node.expressions.length) parts.push({expression: source.slice(node.expressions[index].start, node.expressions[index].end)})
        })
        return {kind: 'path', parts: parts}
    }
    return undefined
}

/**
 * Visit the nodes of a syntax tree, depth first: the children of a node are not visited when the visitor returns false
 * @param node
 * @param visit
 */
function walk(node: any, visit: (node: any) => boolean | void): void {
    if (!node || typeof node.type !== 'string') return
    if (visit(node) === false) return
    for (const key of Object.keys(node)) {
        const value: unknown = node[key]
        if (Array.isArray(value)) for (const child of value) walk(child, visit)
        else if (value && typeof value === 'object' && typeof (value as any).type === 'string') walk(value, visit)
    }
}

/**
 * A text in a template literal
 * @param text
 */
function templateText(text: string): string {
    return text.replace(/[`\\]|\$\{/g, (matched: string): string => `\\${matched}`)
}

/**
 * The scripts an application runs on its own, by their paths, which the bundler does not follow: the scripts of its
 * workers (new Worker(), the pools of workers given a file), of its child processes (fork()), the modules it loads by
 * their paths (require(path.join(__dirname, 'x.js'))), in its modules and in the ones of its packages. A path to a script
 * given from its module, wherever it is written, is found when the module is bundled: the script is bundled on its own
 * into the native tree (FILES_DIRECTORY, the directories mirrored), and the expression rewritten to it. A path known at
 * run time only in part (a template, a concatenation, an argument of path.join: `${name}.js`) gives every script of its
 * directory its pattern matches, the expression of the part kept. The scripts of the workers of node (worker_threads)
 * whose paths cannot be followed are warned of, in the modules of the application (the packages start workers from the
 * paths their users give)
 */
export class FileCollector {
    /**
     * The scripts: their paths in the native tree, and their files
     */
    public readonly scripts: Map<string, string> = new Map()

    /**
     * The other files: their paths in the native tree, and their files
     */
    public readonly files: Map<string, string> = new Map()

    /**
     * The files and the directories of data the paths name
     */
    public readonly roots: Set<string> = new Set()

    public readonly warnings: string[] = []

    protected readonly project: string

    /**
     * @param project The directory of the project: the scripts are named from it (as the modules the bundler gives, its
     * real path)
     * @param addons The packages sharing the framework and holding addons
     */
    constructor(project: string, protected readonly addons?: AddonPackages) {
        this.project = realpathSync(project)
    }

    /**
     * The key of a directory in the tree ("/" separated): its path from the project; outside of the project (the
     * packages of a workspace, linked), its path from the node_modules holding it, else a hash of its path (the paths of
     * the machine bundling it are not shipped)
     * @param directory
     */
    protected keyOf(directory: string): string {
        const relative: string = path.relative(this.project, directory)
        if (!relative.startsWith('..')) return relative.split(path.sep).join('/')
        const segments: string[] = directory.split(path.sep)
        const modules: number = segments.indexOf('node_modules')
        return modules >= 0 ? segments.slice(modules).join('/') : `_outside/${createHash('sha256').update(directory).digest('hex').slice(0, 16)}`
    }

    /**
     * The files of the scripts
     */
    public scriptPaths(): Set<string> {
        return new Set(this.scripts.values())
    }

    /**
     * The name of a script: its path from the project ("/" separated), or from the node_modules holding it outside of the
     * project (the packages of a workspace)
     * @param script
     */
    public nameOf(script: string): string {
        const relative: string = path.relative(this.project, script)
        const segments: string[] = script.split(path.sep)
        const modules: number = segments.indexOf('node_modules')
        return relative.startsWith('..') && modules >= 0 ? segments.slice(modules).join('/') : relative.split(path.sep).join('/')
    }

    /**
     * What a path gives: the file or the directory, or the ones its pattern matches (an expression matches a part of a
     * name); the directory they are named from, the parts of their paths from it
     * @param found
     * @param file the module
     */
    protected targetsOf(found: ScriptPath, file: string): Targets {
        //The directory: the texts before the first expression, up to their last separator
        const firstExpression: number = found.parts.findIndex((part: Part): boolean => 'expression' in part)
        const leading: Part[] = firstExpression < 0 ? found.parts : found.parts.slice(0, firstExpression)
        const prefix: string = leading.map((part: Part): string => (part as { text: string }).text).join('')
        const cut: number = prefix.lastIndexOf('/')
        const directory: string = path.resolve(path.join(found.base ?? path.dirname(file), prefix.slice(0, cut + 1)))
        const rest: Part[] = [...prefix.slice(cut + 1) ? [{text: prefix.slice(cut + 1)}] : [], ...found.parts.slice(leading.length)]
        const targets: Targets = {directory: directory, rest: rest, scripts: [], files: [], roots: []}
        const addons: string | undefined = this.addons?.packageOf(file)
        //A file: bundled when it is a script, copied otherwise; a directory of data: its files copied
        const take = (at: string, strict: boolean): void => {
            const stats = statSync(at)
            if (stats.isFile()) {
                (SCRIPT.test(at) ? targets.scripts : targets.files).push(at)
                targets.roots.push(at)
            } else if (stats.isDirectory()) {
                //A directory of the package of addons of the module, bundled with the application: its native files
                //(its addons found from it, as node-gyp-build finds them)
                if (addons && (at + path.sep).startsWith(addons + path.sep)) {
                    targets.files.push(...this.addons!.nativeFilesOf(addons, at))
                    targets.roots.push(at)
                    //The directory named exactly (the package above the module): the files are named from it
                    if (strict) {
                        targets.directory = at
                        targets.rest = []
                    }
                } else if ((file + path.sep).startsWith(at + path.sep)) {
                    //A directory holding the module (the application, its packages), or holding code: not shipped
                    if (strict) targets.refused = 'ancestor'
                } else if (holdsCode(at)) {
                    if (strict) targets.refused = 'code'
                } else {
                    targets.files.push(...filesOf(at))
                    targets.roots.push(at)
                }
            }
        }
        if (firstExpression < 0) {
            const target: string = path.join(directory, prefix.slice(cut + 1))
            if (existsSync(target)) take(target, true)
            return targets
        }
        const pattern: RegExp = new RegExp(`^${rest.map((part: Part): string => 'text' in part ? part.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '[^/]*').join('')}$`)
        const depth: number = rest.map((part: Part): string => 'text' in part ? part.text : '').join('').split('/').length
        const search = (at: string, relative: string, level: number): void => {
            if (level > depth || !existsSync(at)) return
            for (const entry of readdirSync(at, {withFileTypes: true})) {
                const name: string = relative ? `${relative}/${entry.name}` : entry.name
                if (entry.name === 'node_modules') continue
                if (pattern.test(name) && (entry.isFile() || entry.isDirectory())) take(path.join(at, entry.name), false)
                else if (entry.isDirectory()) search(path.join(at, entry.name), name, level + 1)
            }
        }
        search(directory, '', 1)
        targets.scripts.sort()
        targets.files.sort()
        return targets
    }

    /**
     * Warn of a worker in a module of the application
     * @param file
     * @param line
     * @param message
     */
    protected warn(file: string, line: number, message: string): void {
        if (file.split(path.sep).includes('node_modules')) return
        this.warnings.push(`${path.relative(this.project, file)}:${line}: ${message}`)
    }

    /**
     * Warn of the scripts bundled with the application and run on their own too: two copies of their modules
     * @param bundled the files of the bundle of the application (their real paths)
     */
    public warnBundled(bundled: Set<string>): void {
        for (const script of new Set(this.scripts.values())) {
            if (!bundled.has(script) || script.split(path.sep).includes('node_modules')) continue
            this.warnings.push(`${path.relative(this.project, script)}: is bundled with the application and run on its own by its path (a worker, a child process, a module loaded by its path): two copies of its module, their state and their classes apart — load it by its path only, or import it only`)
        }
    }

    /**
     * The source of a module with its paths to scripts rewritten to the scripts in the native tree; undefined when it
     * gives none
     * @param source
     * @param file
     */
    public transform(source: string, file: string): string | undefined {
        if (!/__dirname|__filename|import\.meta|require\.resolve|\bWorker\b/.test(source)) return undefined
        let program: any
        for (const sourceType of ['module', 'script'] as const) {
            try {
                program = parse(source, {ecmaVersion: 'latest', sourceType: sourceType, locations: true, allowHashBang: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowImportExportEverywhere: true})
                break
            } catch {
                program = undefined
            }
        }
        if (!program) return undefined
        //The values of the variables (const script = ...) and of the properties of the classes (workerPath = ..., this.workerPath
        //= ...) declared once; the constructors of the workers of node and their modules (Worker, worker_threads_1)
        const constants: Map<string, any> = new Map()
        const members: Map<string, any> = new Map()
        const constructors: Set<string> = new Set()
        const namespaces: Set<string> = new Set()
        //The names of the properties (a.__dirname, {__dirname: a}, {__dirname}), which are not to be rewritten; whether the
        //module declares a __dirname of its own (a variable, a parameter: the name is not the directory of the module)
        const properties: Set<any> = new Set()
        let declaresDirname: boolean = false
        const names = (pattern: any): boolean => {
            let found: boolean = false
            walk(pattern, (node: any): void => {
                if (node.type === 'Identifier' && node.name === '__dirname') found = true
            })
            return found
        }
        const remember = (values: Map<string, any>, name: string, value: any): unknown => values.set(name, values.has(name) ? null : value)
        walk(program, (node: any): void => {
            if (node.type === 'MemberExpression' && !node.computed) properties.add(node.property)
            if (node.type === 'Property' && !node.computed) {
                properties.add(node.key)
                if (node.shorthand) properties.add(node.value)
            }
            if ((node.type === 'VariableDeclarator' && names(node.id)) || (node.type === 'CatchClause' && node.param && names(node.param)) || (/Function/.test(node.type) && node.params.some(names))) declaresDirname = true
            if (node.type === 'ImportDeclaration' && WORKER_THREADS.has(node.source.value)) {
                for (const specifier of node.specifiers) {
                    if (specifier.type === 'ImportSpecifier' && (specifier.imported.name ?? specifier.imported.value) === 'Worker') constructors.add(specifier.local.name)
                    else if (specifier.type !== 'ImportSpecifier') namespaces.add(specifier.local.name)
                }
            }
            if (node.type === 'VariableDeclaration') {
                for (const declarator of node.declarations) {
                    const init: any = declarator.init?.type === 'CallExpression' && isRequireOf(declarator.init.arguments[0], WORKER_THREADS) ? declarator.init.arguments[0] : declarator.init
                    if (declarator.id.type === 'Identifier') {
                        remember(constants, declarator.id.name, declarator.init)
                        if (isRequireOf(init, WORKER_THREADS)) namespaces.add(declarator.id.name)
                        if (init?.type === 'MemberExpression' && isRequireOf(init.object, WORKER_THREADS) && calleeName(init) === 'Worker') constructors.add(declarator.id.name)
                    } else if (declarator.id.type === 'ObjectPattern' && isRequireOf(init, WORKER_THREADS)) {
                        for (const property of declarator.id.properties) if (property.key?.name === 'Worker' && property.value?.type === 'Identifier') constructors.add(property.value.name)
                    }
                }
            }
            if (node.type === 'PropertyDefinition' && !node.computed && node.key && node.value) remember(members, node.key.name, node.value)
            if (node.type === 'AssignmentExpression' && node.operator === '=' && node.left.type === 'MemberExpression' && node.left.object.type === 'ThisExpression' && !node.left.computed) remember(members, node.left.property.name, node.right)
        })
        //The paths to files, wherever they are written. In a module of a package of addons bundled with the application,
        //the directory of the module itself too (given to node-gyp-build): the native files of the package are there, in
        //the tree (a __dirname the module declares is its own: the value it is given, rewritten when it is the directory)
        const ownDirectory: boolean = !!this.addons?.packageOf(file)
        const isOwnDirectory = (node: any): boolean => ownDirectory && isDirname(node) && !properties.has(node) && !(node.type === 'Identifier' && declaresDirname)
        const edits: { start: number, end: number, text: string }[] = []
        const followed: Set<any> = new Set()
        walk(program, (node: any): boolean => {
            const found: ScriptPath | undefined = scriptPathOf(node, source, file) ?? (isOwnDirectory(node) ? {kind: 'path', parts: []} : undefined)
            if (!found) return true
            const targets: Targets = this.targetsOf(found, file)
            const written: string = source.slice(node.start, node.end)
            if (targets.refused === 'ancestor') {
                this.warn(file, node.loc.start.line, `the path (${written}) is a directory holding the module, which is not where it is once bundled (the bundle is elsewhere, the code and the packages of the application are not shipped): declare the files it reads as resources (lakutata.resources) and read them from resourcesPath()`)
                return false
            }
            if (targets.refused === 'code') {
                this.warn(file, node.loc.start.line, `the path (${written}) is a directory of scripts or of packages, which need their packages at run time: it is not shipped with the bundle — import its scripts, or declare it as a resource (lakutata.resources) with what it loads`)
                return false
            }
            //A path to nothing yet (a directory the application creates): left as it is
            if (!targets.scripts.length && !targets.files.length) return true
            const key: string = this.keyOf(targets.directory)
            const at = (target: string): string => [FILES_DIRECTORY, key, path.relative(targets.directory, target).split(path.sep).join('/')].filter(Boolean).join('/')
            for (const script of targets.scripts) this.scripts.set(at(script), script)
            for (const data of targets.files) this.files.set(at(data), data)
            for (const root of targets.roots) this.roots.add(root)
            const relative: string = `\`${targets.rest.map((part: Part): string => 'text' in part ? templateText(part.text) : `\${${part.expression}}`).join('')}\``
            const text: string = found.kind === 'url' ? `new URL(${relative}, require.lakutataFilesURL(${JSON.stringify(key)}))` :
                found.kind === 'url-text' ? `(require.lakutataFilesURL(${JSON.stringify(key)}) + ${relative})` :
                    `require("node:path").join(require.lakutataFiles(${JSON.stringify(key)}), ${relative})`
            followed.add(node)
            edits.push({start: node.start, end: node.end, text: text})
            return false
        })
        //The workers of node whose scripts are not followed
        walk(program, (node: any): void => {
            if (node.type !== 'NewExpression' || !node.arguments.length) return
            const callee: any = node.callee
            const isWorker: boolean = callee.type === 'Identifier' ? constructors.has(callee.name) :
                calleeName(callee) === 'Worker' && callee.type === 'MemberExpression' && ((callee.object.type === 'Identifier' && namespaces.has(callee.object.name)) || isRequireOf(callee.object, WORKER_THREADS))
            if (!isWorker) return
            //A worker running a source (eval: true)
            const options: any = node.arguments[1]
            if (options?.type === 'ObjectExpression' && options.properties.some((property: any): boolean => property.key?.name === 'eval' && property.value?.value === true)) return
            const argument: any = node.arguments[0]
            const value: any = argument.type === 'Identifier' && constants.get(argument.name) ? constants.get(argument.name) :
                argument.type === 'MemberExpression' && argument.object.type === 'ThisExpression' && !argument.computed && members.get(argument.property.name) ? members.get(argument.property.name) : argument
            if (followed.has(value)) return
            //As written: the warnings name it
            const written: string = source.slice(argument.start, argument.end)
            const line: number = node.loc.start.line
            if (scriptPathOf(value, source, file)) return this.warn(file, line, `the script of the worker (${written}) is not found: a .js or .cjs file from the module, built before the bundle`)
            if (value.type === 'Literal' && typeof value.value === 'string') return this.warn(file, line, `the script of the worker (${value.value}) is a path from the current directory of the process, not the bundle: give it from the directory of the module, path.join(__dirname, ${JSON.stringify(value.value)}) or new URL(${JSON.stringify(value.value)}, import.meta.url)`)
            this.warn(file, line, `the script of the worker cannot be followed (${written}): give its path from the directory of the module (path.join(__dirname, 'worker.js'), new URL('./worker.js', import.meta.url)), or ship it as a resource (lakutata.resources)`)
        })
        if (!edits.length) return undefined
        let result: string = source
        for (const edit of edits.sort((a, b): number => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
        return result
    }
}
