import {existsSync} from 'node:fs'
import {readdir, readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {newestVersion} from '../Registry.js'

/**
 * The fields of the dependencies of a package
 */
export const DEPENDENCY_FIELDS: string[] = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

/**
 * A JSON file, written back with its indentation and its final newline
 */
export class JSONFile<T extends Record<string, any> = Record<string, any>> {

    protected constructor(public readonly file: string, public data: T, protected readonly indent: string, protected readonly newline: boolean) {
    }

    /**
     * Read a JSON file
     * @param file
     */
    public static async read<T extends Record<string, any>>(file: string): Promise<JSONFile<T>> {
        const text: string = await readFile(file, 'utf8')
        const indent: string = /^[ \t]+(?=")/m.exec(text)?.[0] ?? '  '
        return new JSONFile<T>(file, JSON.parse(text), indent, text.endsWith('\n'))
    }

    /**
     * Write the file back
     */
    public async write(): Promise<void> {
        await writeFile(this.file, `${JSON.stringify(this.data, null, this.indent)}${this.newline ? '\n' : ''}`)
    }
}

/**
 * A package of the workspace
 */
export type WorkspacePackage = {
    name: string
    version: string | undefined
    directory: string
    manifest: JSONFile
    private: boolean
    scripts: Record<string, string>
    /**
     * The packages of the workspace it depends on
     */
    dependencies: string[]
}

/**
 * Whether a name matches a pattern with "*" wildcards
 * @param name
 * @param pattern
 */
export function matchName(name: string, pattern: string): boolean {
    return new RegExp(`^${pattern.split('*').map((part: string): string => part.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('.*')}$`).test(name)
}

/**
 * The directories matching a workspace pattern ("packages/*", "apps/**", "tools/cli")
 * @param root
 * @param pattern
 */
async function expandPattern(root: string, pattern: string): Promise<string[]> {
    const segments: string[] = pattern.replace(/^\.\//, '').replace(/\/+$/, '').split('/').filter((segment: string): boolean => !!segment)
    const walk = async (directory: string, index: number): Promise<string[]> => {
        if (index === segments.length) return [directory]
        const segment: string = segments[index]
        if (!segment.includes('*')) return existsSync(path.join(directory, segment)) ? walk(path.join(directory, segment), index + 1) : []
        let entries: string[]
        try {
            entries = (await readdir(directory, {withFileTypes: true}))
                .filter((entry): boolean => entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.'))
                .map((entry): string => entry.name)
        } catch {
            return []
        }
        const found: string[] = []
        if (segment === '**') {
            //Any depth, including none
            found.push(...await walk(directory, index + 1))
            for (const entry of entries) found.push(...await walk(path.join(directory, entry), index))
        } else {
            for (const entry of entries) if (matchName(entry, segment)) found.push(...await walk(path.join(directory, entry), index + 1))
        }
        return found
    }
    return walk(root, 0)
}

/**
 * The patterns of the packages of a pnpm workspace
 * @param file
 */
async function pnpmPatterns(file: string): Promise<string[]> {
    const patterns: string[] = []
    let inPackages: boolean = false
    for (const line of (await readFile(file, 'utf8')).split('\n')) {
        if (/^packages:\s*$/.test(line)) {
            inPackages = true
            continue
        }
        if (inPackages) {
            const matched: RegExpExecArray | null = /^\s+-\s+['"]?([^'"#]+?)['"]?\s*(#.*)?$/.exec(line)
            if (matched) patterns.push(matched[1])
            else if (/^\S/.test(line)) inPackages = false
        }
    }
    return patterns
}

/**
 * A workspace: its root, its packages and their fixed version
 */
export class Workspace {

    protected constructor(public readonly root: string, public readonly manifest: JSONFile, public readonly packages: WorkspacePackage[], public readonly lerna: JSONFile | undefined) {
    }

    /**
     * The workspace of a directory: the nearest directory declaring workspaces
     * @param start
     */
    public static async find(start: string = process.cwd()): Promise<Workspace> {
        for (let directory: string = path.resolve(start); ; directory = path.dirname(directory)) {
            const manifestFile: string = path.join(directory, 'package.json')
            if (existsSync(manifestFile)) {
                const manifest: JSONFile = await JSONFile.read(manifestFile)
                const declared: unknown = manifest.data.workspaces
                let patterns: string[] | undefined = Array.isArray(declared) ? declared : Array.isArray((declared as any)?.packages) ? (declared as any).packages : undefined
                if (!patterns && existsSync(path.join(directory, 'pnpm-workspace.yaml'))) patterns = await pnpmPatterns(path.join(directory, 'pnpm-workspace.yaml'))
                if (patterns) return await this.load(directory, manifest, patterns)
            }
            if (path.dirname(directory) === directory) throw new Error(`${path.resolve(start)} is not in a workspace (a package.json declaring "workspaces", or a pnpm-workspace.yaml)`)
        }
    }

    /**
     * Load the packages of a workspace
     * @param root
     * @param manifest
     * @param patterns
     */
    protected static async load(root: string, manifest: JSONFile, patterns: string[]): Promise<Workspace> {
        const included: Set<string> = new Set()
        for (const pattern of patterns.filter((pattern: string): boolean => !pattern.startsWith('!'))) for (const directory of await expandPattern(root, pattern)) included.add(directory)
        for (const pattern of patterns.filter((pattern: string): boolean => pattern.startsWith('!'))) for (const directory of await expandPattern(root, pattern.slice(1))) included.delete(directory)
        const packages: WorkspacePackage[] = []
        for (const directory of [...included].sort()) {
            if (!existsSync(path.join(directory, 'package.json'))) continue
            const packageManifest: JSONFile = await JSONFile.read(path.join(directory, 'package.json'))
            if (typeof packageManifest.data.name !== 'string') continue
            packages.push({
                name: packageManifest.data.name,
                version: packageManifest.data.version,
                directory: directory,
                manifest: packageManifest,
                private: packageManifest.data.private === true,
                scripts: packageManifest.data.scripts ?? {},
                dependencies: []
            })
        }
        const names: Set<string> = new Set(packages.map((pkg: WorkspacePackage): string => pkg.name))
        for (const pkg of packages) {
            const dependencies: Set<string> = new Set()
            for (const field of DEPENDENCY_FIELDS) for (const name of Object.keys(pkg.manifest.data[field] ?? {})) if (names.has(name) && name !== pkg.name) dependencies.add(name)
            pkg.dependencies = [...dependencies]
        }
        const lernaFile: string = path.join(root, 'lerna.json')
        return new Workspace(root, manifest, packages, existsSync(lernaFile) ? await JSONFile.read(lernaFile) : undefined)
    }

    /**
     * A package by name
     * @param name
     */
    public get(name: string): WorkspacePackage | undefined {
        return this.packages.find((pkg: WorkspacePackage): boolean => pkg.name === name)
    }

    /**
     * The packages a package depends on, directly or not
     * @param pkg
     */
    public transitiveDependencies(pkg: WorkspacePackage): Set<string> {
        const found: Set<string> = new Set()
        const visit = (name: string): void => {
            for (const dependency of this.get(name)?.dependencies ?? []) {
                if (found.has(dependency)) continue
                found.add(dependency)
                visit(dependency)
            }
        }
        visit(pkg.name)
        found.delete(pkg.name)
        return found
    }

    /**
     * The cycles of the dependencies, as lists of package names
     */
    public cycles(): string[][] {
        const cycles: string[][] = []
        const state: Map<string, 'visiting' | 'done'> = new Map()
        const stack: string[] = []
        const visit = (name: string): void => {
            state.set(name, 'visiting')
            stack.push(name)
            for (const dependency of this.get(name)?.dependencies ?? []) {
                if (state.get(dependency) === 'visiting') cycles.push([...stack.slice(stack.indexOf(dependency)), dependency])
                else if (!state.has(dependency)) visit(dependency)
            }
            stack.pop()
            state.set(name, 'done')
        }
        for (const pkg of this.packages) if (!state.has(pkg.name)) visit(pkg.name)
        return cycles
    }

    /**
     * The fixed version of the workspace: the one of lerna.json, of the root package.json, or the highest of the packages
     */
    public get version(): string | undefined {
        return this.lerna?.data.version ?? this.manifest.data.version ?? newestVersion(this.packages.map((pkg: WorkspacePackage): string | undefined => pkg.version).filter((version: string | undefined): version is string => !!version))
    }
}
