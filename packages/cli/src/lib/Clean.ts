import {existsSync} from 'node:fs'
import {readFile, rm} from 'node:fs/promises'
import {createRequire} from 'node:module'
import path from 'node:path'

/**
 * The paths a clean never removes: the package itself, its sources, its dependencies and its manifest
 */
const PROTECTED: string[] = ['node_modules', 'src', 'package.json', '.git']

/**
 * The result of a clean
 */
export type CleanResult = {
    /**
     * The paths removed, relative to the package
     */
    removed: string[]
    /**
     * The paths which did not exist
     */
    missing: string[]
}

/**
 * The text of a JSON with comments and trailing commas (a tsconfig.json) as JSON: the comments and the commas before a
 * closing bracket are removed outside of the strings
 * @param text
 */
function StripJSONC(text: string): string {
    let output: string = ''
    for (let index: number = 0; index < text.length; index++) {
        const char: string = text[index]
        if (char === '"') {
            //A string, its escaped quotes included
            let end: number = index + 1
            while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1
            output += text.slice(index, end + 1)
            index = end
        } else if (char === '/' && text[index + 1] === '/') {
            while (index < text.length && text[index] !== '\n') index++
            output += '\n'
        } else if (char === '/' && text[index + 1] === '*') {
            index = text.indexOf('*/', index + 2)
            if (index < 0) break
            index++
        } else if (char === ',') {
            //A trailing comma: the next character, whitespaces and comments skipped, closes an object or an array
            let next: number = index + 1
            for (; ;) {
                while (next < text.length && /\s/.test(text[next])) next++
                if (text[next] === '/' && text[next + 1] === '/') next = text.indexOf('\n', next) < 0 ? text.length : text.indexOf('\n', next)
                else if (text[next] === '/' && text[next + 1] === '*') next = text.indexOf('*/', next + 2) < 0 ? text.length : text.indexOf('*/', next + 2) + 2
                else break
            }
            if (text[next] !== '}' && text[next] !== ']') output += char
        } else {
            output += char
        }
    }
    return output
}

/**
 * The file of a configuration extended: a path relative to the configuration, or a module (lakutata/tsconfig.json)
 * @param from the configuration extending it
 * @param specifier
 */
function ExtendedConfiguration(from: string, specifier: string): string | undefined {
    if (specifier.startsWith('.') || path.isAbsolute(specifier)) {
        const file: string = path.resolve(path.dirname(from), specifier)
        return [file, `${file}.json`].find((candidate: string): boolean => existsSync(candidate) && !candidate.endsWith(path.sep))
    }
    const require: NodeJS.Require = createRequire(from)
    for (const candidate of [specifier, `${specifier}.json`, `${specifier}/tsconfig.json`]) {
        try {
            return require.resolve(candidate)
        } catch {
            //The next form of the specifier
        }
    }
    return undefined
}

/**
 * The output directories of a TypeScript configuration and of the ones it extends (outDir, declarationDir), absolute:
 * each one relative to the configuration giving it, the closest configuration winning
 * @param file
 * @param depth
 */
async function ConfigurationOutputs(file: string, depth: number = 0): Promise<{ outDir?: string, declarationDir?: string }> {
    const configuration: { extends?: string | string[], compilerOptions?: Record<string, unknown> } = JSON.parse(StripJSONC(await readFile(file, 'utf8')))
    let outputs: { outDir?: string, declarationDir?: string } = {}
    const extended: string[] = configuration.extends === undefined ? [] : Array.isArray(configuration.extends) ? configuration.extends : [configuration.extends]
    if (depth < 8) {
        for (const specifier of extended) {
            const parent: string | undefined = ExtendedConfiguration(file, specifier)
            if (parent) outputs = {...outputs, ...await ConfigurationOutputs(parent, depth + 1)}
        }
    }
    for (const option of ['outDir', 'declarationDir'] as const) {
        const value: unknown = configuration.compilerOptions?.[option]
        if (typeof value === 'string') outputs[option] = path.resolve(path.dirname(file), value)
    }
    return outputs
}

/**
 * The output directories of the TypeScript configuration of a package (its tsconfig.json): outDir and declarationDir
 * @param directory
 * @return the directories, relative to the package
 */
export async function OutputDirectories(directory: string): Promise<string[]> {
    const file: string = path.join(directory, 'tsconfig.json')
    if (!existsSync(file)) throw new Error(`${directory} has no tsconfig.json: give the paths removed (lakutata clean <paths...>)`)
    const outputs: { outDir?: string, declarationDir?: string } = await ConfigurationOutputs(file)
    const directories: string[] = [...new Set([outputs.outDir, outputs.declarationDir].filter((output: string | undefined): output is string => !!output))]
    if (!directories.length) throw new Error(`The tsconfig.json of ${directory} gives no outDir: give the paths removed (lakutata clean <paths...>)`)
    return directories.map((output: string): string => path.relative(directory, output))
}

/**
 * Remove paths of a package (as rm -rf, on every platform): only the paths inside the package, never the package itself,
 * its sources, its dependencies nor its manifest
 * @param directory the directory of the package
 * @param paths relative to the package
 */
export async function Clean(directory: string, paths: string[]): Promise<CleanResult> {
    const root: string = path.resolve(directory)
    const targets: { relative: string, absolute: string }[] = paths.map((target: string): { relative: string, absolute: string } => {
        const absolute: string = path.resolve(root, target)
        const relative: string = path.relative(root, absolute)
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${target} is not inside the package ${root}: it is not removed`)
        if (PROTECTED.includes(relative.split(path.sep)[0])) throw new Error(`${target} is protected (${PROTECTED.join(', ')}): it is not removed`)
        return {relative: relative, absolute: absolute}
    })
    const result: CleanResult = {removed: [], missing: []}
    for (const target of targets) {
        if (!existsSync(target.absolute)) {
            result.missing.push(target.relative)
            continue
        }
        await rm(target.absolute, {recursive: true, force: true})
        result.removed.push(target.relative)
    }
    return result
}
