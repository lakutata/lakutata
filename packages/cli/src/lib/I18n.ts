import {existsSync} from 'node:fs'
import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {NormalizeLocale} from 'lakutata/com/i18n'

/**
 * The messages of the validation (validation.json, the validation key of a file): not copied to a new language, which
 * has its built-in ones
 */
const VALIDATION: string = 'validation'

/**
 * Write a file of the messages of a new language, made of a file of the default language (its validation messages left)
 * @param source
 * @param target
 */
async function CopyMessages(source: string, target: string): Promise<void> {
    const messages: Record<string, unknown> = JSON.parse(await readFile(source, 'utf8'))
    delete messages[VALIDATION]
    await writeFile(target, `${JSON.stringify(messages, null, 2)}\n`)
}

/**
 * Copy the files of the messages of a directory of the default language, its validation messages left
 * @param source
 * @param target
 * @param root whether it is the directory of the language (its validation.json and validation directory are left)
 */
async function CopyDirectory(source: string, target: string, root: boolean): Promise<string[]> {
    const files: string[] = []
    await mkdir(target, {recursive: true})
    for (const entry of (await readdir(source, {withFileTypes: true})).sort((a, b): number => a.name.localeCompare(b.name))) {
        if (root && (entry.name === `${VALIDATION}.json` || entry.name === VALIDATION)) continue
        if (entry.isDirectory()) {
            files.push(...await CopyDirectory(path.join(source, entry.name), path.join(target, entry.name), false))
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
            await CopyMessages(path.join(source, entry.name), path.join(target, entry.name))
            files.push(path.join(target, entry.name))
        }
    }
    return files
}

/**
 * Add the messages of a language to a directory of the messages, made of the ones of the default language (a file or a
 * directory, as the default language has): they are to be translated, lakutata i18n check telling the ones which are not
 * @param directory
 * @param locale
 * @param defaultLocale
 * @return the files written
 */
export async function AddLocale(directory: string, locale: string, defaultLocale: string): Promise<string[]> {
    const tag: string | undefined = NormalizeLocale(locale)
    if (!tag) throw new Error(`"${locale}" is not the tag of a language (en, zh-CN, zh-Hant-TW)`)
    const base: string = NormalizeLocale(defaultLocale) ?? defaultLocale
    if (tag === base) throw new Error(`${tag} is the default language`)
    if (existsSync(path.join(directory, `${tag}.json`)) || existsSync(path.join(directory, tag))) throw new Error(`The messages of ${tag} exist already in ${directory}`)
    if (existsSync(path.join(directory, `${base}.json`))) {
        const target: string = path.join(directory, `${tag}.json`)
        await CopyMessages(path.join(directory, `${base}.json`), target)
        return [target]
    }
    if (existsSync(path.join(directory, base))) return await CopyDirectory(path.join(directory, base), path.join(directory, tag), true)
    throw new Error(`There are no messages of the default language ${base} in ${directory} (${base}.json or ${base}/)`)
}
