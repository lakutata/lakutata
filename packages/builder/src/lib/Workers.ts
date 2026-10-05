import {existsSync, readdirSync, realpathSync, statSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {parse} from 'acorn'

/**
 * The directory of the scripts of the workers in the native tree
 */
export const WORKERS_DIRECTORY: string = '.lakutata/workers'

/**
 * A piece of the path of the script of a worker: a text, or an expression known at run time only (the source of the
 * expression)
 */
type Part = { text: string } | { expression: string }

/**
 * The path of the script of a worker found in a module: from the directory of the module (a path built by path.join,
 * path.resolve, a concatenation or a template), from its file (a URL relative to import.meta.url or to the URL of its
 * __filename), or a file resolved when the application is bundled (require.resolve)
 */
type WorkerPath = {
    kind: 'path' | 'url'
    parts: Part[]
    /**
     * The directory the parts are relative to, when it is not the one of the module (require.resolve)
     */
    directory?: string
}

/**
 * The scripts the workers run: their extensions (the ones of the CommonJS scripts, which the scripts of the workers are
 * bundled as)
 */
const SCRIPT: RegExp = /\.c?js$/

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
 * The path of the script of a worker given by an expression, undefined when it cannot be followed
 * @param node
 * @param source
 * @param file the module
 */
function workerPathOf(node: any, source: string, file: string): WorkerPath | undefined {
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
                if (!pieces || argument.type === 'SpreadElement') return undefined
                parts.push({text: '/'}, ...pieces)
            }
            return {kind: 'path', parts: parts}
        }
        //require.resolve('./worker.js')
        if (name === 'resolve' && node.callee.type === 'MemberExpression' && node.callee.object.type === 'Identifier' && node.callee.object.name === 'require' &&
            node.arguments[0]?.type === 'Literal' && typeof node.arguments[0].value === 'string') {
            try {
                const resolved: string = createRequire(file).resolve(node.arguments[0].value)
                return {kind: 'path', parts: [{text: path.basename(resolved)}], directory: path.dirname(resolved)}
            } catch {
                return undefined
            }
        }
        //pathToFileURL(<a path of the module>)
        if (name === 'pathToFileURL') return workerPathOf(node.arguments[0], source, file)
    }
    //__dirname + '/worker.js'
    if (node?.type === 'BinaryExpression' && node.operator === '+') {
        const [base, ...rest] = operandsOf(node)
        if (!isDirname(base)) return undefined
        const parts: Part[] = []
        for (const operand of rest) {
            const pieces: Part[] | undefined = partsOf(operand, source)
            if (!pieces) return undefined
            parts.push(...pieces)
        }
        return {kind: 'path', parts: parts}
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
 * The nodes of a syntax tree, depth first
 * @param node
 * @param visit
 */
function walk(node: any, visit: (node: any) => void): void {
    if (!node || typeof node.type !== 'string') return
    visit(node)
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
 * The scripts of the workers of an application, which the bundler does not follow (new Worker() takes a path): found in
 * the modules bundled, bundled each into the native tree (WORKERS_DIRECTORY), the expressions of their paths rewritten
 * to their paths in the tree. A path known at run time only in part (a template, a concatenation, an argument of
 * path.join: `${name}.js`) gives every script of its directory its pattern matches, laid out as they are (the expression
 * of the part kept): the tree mirrors the directories of the scripts. The paths which cannot be followed are warned of,
 * in the modules of the application (the libraries start workers from the paths their users give)
 */
export class WorkerCollector {
    /**
     * The scripts of the workers: their paths in the native tree, and their files
     */
    public readonly scripts: Map<string, string> = new Map()

    public readonly warnings: string[] = []

    protected readonly project: string

    /**
     * @param project The directory of the project: the scripts are named from it (as the modules the bundler gives, its
     * real path)
     */
    constructor(project: string) {
        this.project = realpathSync(project)
    }

    /**
     * The key of a directory in the tree: its path from the project ("/" separated, the parent directories named
     * _parent)
     * @param directory
     */
    protected keyOf(directory: string): string {
        const relative: string = path.relative(this.project, directory)
        return relative ? relative.split(path.sep).map((segment: string): string => segment === '..' ? '_parent' : segment).join('/') : '_'
    }

    /**
     * The scripts a path of a worker gives: the file, or the ones its pattern matches; their directory and the parts of
     * their paths from it
     * @param found
     * @param file the module
     */
    protected scriptsOf(found: WorkerPath, file: string): { directory: string, rest: Part[], files: string[] } {
        //The directory: the texts before the first expression, up to their last separator
        const firstExpression: number = found.parts.findIndex((part: Part): boolean => 'expression' in part)
        const leading: Part[] = firstExpression < 0 ? found.parts : found.parts.slice(0, firstExpression)
        const prefix: string = leading.map((part: Part): string => (part as { text: string }).text).join('')
        const cut: number = prefix.lastIndexOf('/')
        const directory: string = path.resolve(path.join(found.directory ?? path.dirname(file), prefix.slice(0, cut + 1)))
        const rest: Part[] = [...prefix.slice(cut + 1) ? [{text: prefix.slice(cut + 1)}] : [], ...found.parts.slice(leading.length)]
        if (firstExpression < 0) {
            const script: string = path.join(directory, prefix.slice(cut + 1))
            return {directory: directory, rest: rest, files: existsSync(script) && statSync(script).isFile() ? [script] : []}
        }
        //The pattern: an expression matches a part of a segment
        const pattern: RegExp = new RegExp(`^${rest.map((part: Part): string => 'text' in part ? part.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '[^/]*').join('')}$`)
        const depth: number = rest.map((part: Part): string => 'text' in part ? part.text : '').join('').split('/').length
        const files: string[] = []
        const search = (at: string, relative: string, level: number): void => {
            if (level > depth || !existsSync(at)) return
            for (const entry of readdirSync(at, {withFileTypes: true})) {
                const name: string = relative ? `${relative}/${entry.name}` : entry.name
                if (entry.isDirectory() && entry.name !== 'node_modules') search(path.join(at, entry.name), name, level + 1)
                else if (entry.isFile() && SCRIPT.test(entry.name) && pattern.test(name)) files.push(path.join(at, entry.name))
            }
        }
        search(directory, '', 1)
        return {directory: directory, rest: rest, files: files.sort()}
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
     * The source of a module with the paths of its workers rewritten to their scripts in the native tree; undefined
     * when it starts no worker
     * @param source
     * @param file
     */
    public transform(source: string, file: string): string | undefined {
        if (!/\bWorker\b/.test(source)) return undefined
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
        //The constants holding the paths (const script = path.join(__dirname, 'worker.js')): the ones declared once
        const constants: Map<string, any> = new Map()
        walk(program, (node: any): void => {
            if (node.type !== 'VariableDeclaration') return
            for (const declarator of node.declarations) {
                if (declarator.id.type !== 'Identifier') continue
                const name: string = declarator.id.name
                constants.set(name, constants.has(name) || node.kind !== 'const' ? null : declarator.init)
            }
        })
        const edits: { start: number, end: number, text: string }[] = []
        const rewritten: Set<any> = new Set()
        walk(program, (node: any): void => {
            if (node.type !== 'NewExpression' || calleeName(node.callee) !== 'Worker' || !node.arguments.length) return
            //A worker running a source (eval: true)
            const options: any = node.arguments[1]
            if (options?.type === 'ObjectExpression' && options.properties.some((property: any): boolean => property.key?.name === 'eval' && property.value?.value === true)) return
            const argument: any = node.arguments[0]
            //As written: the warnings name it
            const written: string = source.slice(argument.start, argument.end)
            const target: any = argument.type === 'Identifier' && constants.get(argument.name) ? constants.get(argument.name) : argument
            if (rewritten.has(target)) return
            const line: number = node.loc.start.line
            const found: WorkerPath | undefined = workerPathOf(target, source, file)
            if (!found) {
                const literal: boolean = target.type === 'Literal' && typeof target.value === 'string'
                return this.warn(file, line, literal ?
                    `the script of the worker (${target.value}) is a path from the current directory of the process, not the bundle: give it from the directory of the module, path.join(__dirname, ${JSON.stringify(target.value)}) or new URL(${JSON.stringify(target.value)}, import.meta.url)` :
                    `the script of the worker cannot be followed (${written}): give its path from the directory of the module (path.join(__dirname, 'worker.js'), new URL('./worker.js', import.meta.url)), or ship it as a resource (lakutata.resources)`)
            }
            const {directory, rest, files} = this.scriptsOf(found, file)
            if (!files.length) return this.warn(file, line, `the script of the worker (${written}) is not found: a .js or .cjs file next to the module, built before the bundle`)
            const key: string = this.keyOf(directory)
            for (const script of files) this.scripts.set(`${WORKERS_DIRECTORY}/${key}/${path.relative(directory, script).split(path.sep).join('/')}`, script)
            const relative: string = `\`${rest.map((part: Part): string => 'text' in part ? templateText(part.text) : `\${${part.expression}}`).join('')}\``
            const text: string = found.kind === 'url' ?
                `new URL(${relative}, require.lakutataWorkerURL(${JSON.stringify(key)}))` :
                `require("node:path").join(require.lakutataWorker(${JSON.stringify(key)}), ${relative})`
            rewritten.add(target)
            edits.push({start: target.start, end: target.end, text: text})
        })
        if (!edits.length) return undefined
        let result: string = source
        for (const edit of edits.sort((a, b): number => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
        return result
    }
}
