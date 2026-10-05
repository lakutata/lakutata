import {existsSync} from 'node:fs'
import {readdir, readFile} from 'node:fs/promises'
import path from 'node:path'
import {I18nCatalogException} from '../exceptions/I18nCatalogException.js'
import {normalizeLocale} from './Locale.js'

/**
 * The messages of a language, nested by the parts of their keys: `{order: {count: '...'}}` holds the key
 * `order.count`. A key part cannot be empty or contain `.`, and every leaf is a string (ICU MessageFormat, or a
 * validation template under `validation`).
 */
export type NestedMessages = { [key: string]: string | NestedMessages }

/**
 * Loaded messages, by canonical language tag then by full key (`order.count`), as {@link loadCatalogs} gives them to
 * {@link checkCatalogs} and {@link generateMessageTypes}.
 */
export type Catalogs = Map<string, Map<string, string>>

/**
 * The messages of nested objects by their keys: {"order": {"count": "..."}} → order.count
 * @param messages
 * @param source where the messages are, for the errors
 * @param prefix
 */
export function flattenMessages(messages: unknown, source: string, prefix: string = ''): Map<string, string> {
    const flat: Map<string, string> = new Map()
    if (messages === null || typeof messages !== 'object' || Array.isArray(messages)) throw new I18nCatalogException(`${source}: the messages must be an object${prefix ? ` (${prefix.slice(0, -1)})` : ''}`)
    for (const [key, value] of Object.entries(messages)) {
        if (!key || key.includes('.')) throw new I18nCatalogException(`${source}: invalid key "${prefix}${key}" (the parts of the keys are nested objects)`)
        if (typeof value === 'string') flat.set(`${prefix}${key}`, value)
        else flattenMessages(value, source, `${prefix}${key}.`).forEach((message: string, name: string): unknown => flat.set(name, message))
    }
    return flat
}

/**
 * Add the messages of a language to catalogs, the ones already there replaced
 * @param catalogs
 * @param locale
 * @param messages
 */
export function mergeMessages(catalogs: Catalogs, locale: string, messages: Map<string, string>): void {
    let catalog: Map<string, string> | undefined = catalogs.get(locale)
    if (!catalog) catalogs.set(locale, catalog = new Map())
    messages.forEach((message: string, key: string): unknown => catalog.set(key, message))
}

/**
 * The language of a name of a file or a directory of a catalog (zh-CN.json, zh-CN)
 * @param name
 * @param file
 */
function localeOfName(name: string, file: string): string {
    const locale: string | undefined = normalizeLocale(name)
    if (!locale || locale.toLowerCase() !== name.toLowerCase().replace(/_/g, '-')) throw new I18nCatalogException(`${file}: "${name}" is not the tag of a language (en, zh-CN, zh-Hant-TW)`)
    return locale
}

async function readJson(file: string): Promise<unknown> {
    try {
        return JSON.parse(await readFile(file, 'utf8'))
    } catch (e) {
        throw new I18nCatalogException(`${file}: ${(e as Error).message}`)
    }
}

/**
 * Load the messages of a directory into catalogs: a file by language (zh-CN.json), or a directory by language whose
 * files (and their directories) prefix their keys (zh-CN/order.json: order.*, zh-CN/admin/user.json: admin.user.*)
 * @param catalogs
 * @param directory
 */
export async function loadDirectory(catalogs: Catalogs, directory: string): Promise<void> {
    if (!existsSync(directory)) throw new I18nCatalogException(`${directory}: the directory of the messages does not exist`)
    const entries = (await readdir(directory, {withFileTypes: true})).sort((a, b): number => a.name.localeCompare(b.name))
    for (const entry of entries) {
        const file: string = path.join(directory, entry.name)
        if (entry.isFile() && entry.name.endsWith('.json')) {
            mergeMessages(catalogs, localeOfName(entry.name.slice(0, -5), file), flattenMessages(await readJson(file), file))
        } else if (entry.isDirectory()) {
            const locale: string = localeOfName(entry.name, file)
            await loadNamespaces(catalogs, locale, file, '')
        }
    }
}

/**
 * Load the files of the directory of a language, their names prefixing their keys
 * @param catalogs
 * @param locale
 * @param directory
 * @param prefix
 */
async function loadNamespaces(catalogs: Catalogs, locale: string, directory: string, prefix: string): Promise<void> {
    const entries = (await readdir(directory, {withFileTypes: true})).sort((a, b): number => a.name.localeCompare(b.name))
    for (const entry of entries) {
        const file: string = path.join(directory, entry.name)
        if (entry.isFile() && entry.name.endsWith('.json')) {
            mergeMessages(catalogs, locale, flattenMessages(await readJson(file), file, `${prefix}${entry.name.slice(0, -5)}.`))
        } else if (entry.isDirectory()) {
            await loadNamespaces(catalogs, locale, file, `${prefix}${entry.name}.`)
        }
    }
}
