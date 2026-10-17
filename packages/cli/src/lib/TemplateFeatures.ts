import {existsSync} from 'node:fs'
import {copyFile, mkdir, readdir, readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'

/**
 * The files the npm packages cannot hold under their name, kept as "_<name>" in the templates
 */
export const DOTFILES: string[] = ['gitignore', 'npmrc', 'npmignore', 'gitattributes', 'editorconfig', 'dockerignore', 'nvmrc', 'env', 'eslintrc.json', 'prettierrc']

/**
 * The path of a file of a template in the project: "_gitignore" becomes ".gitignore"
 * @param file relative to the template
 */
export function projectPath(file: string): string {
    const name: string = path.basename(file)
    return name.startsWith('_') && DOTFILES.includes(name.slice(1)) ? path.join(path.dirname(file), `.${name.slice(1)}`) : file
}

/**
 * The optional features of a template, declared by its package (its "lakutata.features" field: their names and their
 * descriptions), their files in its features/<name> directory
 * @param packageRoot the directory of the package of the template
 */
export async function readTemplateFeatures(packageRoot: string): Promise<Record<string, string>> {
    const manifest: string = path.join(packageRoot, 'package.json')
    if (!existsSync(manifest)) return {}
    const features: unknown = JSON.parse(await readFile(manifest, 'utf8'))?.lakutata?.features
    if (features === undefined) return {}
    if (features === null || typeof features !== 'object' || Array.isArray(features) ||
        Object.entries(features).some(([name, description]): boolean => !/^[a-z][a-z0-9-]*$/.test(name) || typeof description !== 'string')) {
        throw new Error(`The features of the template (${manifest}, lakutata.features) must be their names (lower case) and their descriptions`)
    }
    return features as Record<string, string>
}

/**
 * Whether a value is a plain object (of JSON)
 * @param value
 */
function isObjectValue(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Merge a JSON value into another one: the objects merged by their keys, the other values replaced
 * @param target
 * @param source
 */
export function mergeJson(target: unknown, source: unknown): unknown {
    if (!isObjectValue(target) || !isObjectValue(source)) return source
    const merged: Record<string, unknown> = {...target}
    for (const [key, value] of Object.entries(source)) merged[key] = key in target ? mergeJson(target[key], value) : value
    return merged
}

/**
 * The files of a directory, relative to it
 * @param directory
 * @param base
 */
async function listFiles(directory: string, base: string = directory): Promise<string[]> {
    const files: string[] = []
    for (const entry of await readdir(directory, {withFileTypes: true})) {
        const file: string = path.join(directory, entry.name)
        if (entry.isDirectory()) files.push(...await listFiles(file, base))
        else files.push(path.relative(base, file))
    }
    return files
}

/**
 * Add the files of a feature to a project: the new files copied, the JSON files the project has merged into its ones
 * (the scripts of package.json, the options of tsconfig.json)
 * @param featureDirectory
 * @param project
 * @param written the files the creation of the project wrote: the other files of the directory (--init) are kept as
 * they are, added to kept
 * @param kept
 * @return the files added to the project, relative to it
 */
export async function applyFeatureFiles(featureDirectory: string, project: string, written?: Set<string>, kept: string[] = []): Promise<string[]> {
    const added: string[] = []
    for (const file of await listFiles(featureDirectory)) {
        const relative: string = projectPath(file)
        const target: string = path.join(project, relative)
        //A file the directory had before the project was created (--init) is kept as it is
        if (written && existsSync(target) && !written.has(relative)) {
            kept.push(relative)
            continue
        }
        await mkdir(path.dirname(target), {recursive: true})
        if (existsSync(target) && file.endsWith('.json')) {
            const merged: unknown = mergeJson(JSON.parse(await readFile(target, 'utf8')), JSON.parse(await readFile(path.join(featureDirectory, file), 'utf8')))
            await writeFile(target, `${JSON.stringify(merged, null, 2)}\n`)
            continue
        }
        await copyFile(path.join(featureDirectory, file), target)
        added.push(relative)
    }
    return added
}

/**
 * A line marking a block of a feature: "//@if <feature>", "//@if !<feature>", "//@else", "//@end", in the comments of
 * the languages (//, #, <!-- -->, /* * /)
 */
const MARKER: RegExp = /^\s*(?:\/\/|#|<!--|\/\*)\s*@(if|else|end)\b\s*(!?[a-z][a-z0-9-]*)?\s*(?:-->|\*\/)?\s*$/

/**
 * The text of a file of a template with the blocks of the features: the blocks of the features enabled kept, the
 * others removed, the markers removed
 * @param text
 * @param enabled the features enabled
 * @param file the file, for the errors
 */
export function applyFeatureBlocks(text: string, enabled: Set<string>, file: string): string {
    if (!/@(?:if|else|end)\b/.test(text)) return text
    const lines: string[] = text.split('\n')
    const kept: string[] = []
    //The blocks the line is in: whether their branch is kept
    const blocks: { keep: boolean, line: number, elsed: boolean }[] = []
    for (const [index, line] of lines.entries()) {
        const marker: RegExpExecArray | null = MARKER.exec(line)
        if (!marker) {
            if (blocks.every((block): boolean => block.keep)) kept.push(line)
            continue
        }
        const [, directive, condition] = marker
        if (directive === 'if') {
            if (!condition) throw new Error(`${file}:${index + 1}: @if needs a feature`)
            const negated: boolean = condition.startsWith('!')
            blocks.push({keep: enabled.has(condition.replace(/^!/, '')) !== negated, line: index + 1, elsed: false})
        } else if (directive === 'else') {
            const block = blocks.at(-1)
            if (!block || block.elsed) throw new Error(`${file}:${index + 1}: @else without its @if`)
            block.keep = !block.keep
            block.elsed = true
        } else {
            if (!blocks.pop()) throw new Error(`${file}:${index + 1}: @end without its @if`)
        }
    }
    if (blocks.length) throw new Error(`${file}:${blocks.at(-1)!.line}: @if without its @end`)
    return kept.join('\n')
}
