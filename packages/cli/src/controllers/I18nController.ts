import {mkdir, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {Controller} from 'lakutata/com/entrypoint'
import {CLIAction} from 'lakutata/decorator/ctrl'
import {checkCatalogs, generateMessageTypes, loadCatalogs, type CatalogIssue, type Catalogs} from 'lakutata/com/i18n'
import {I18nDTO} from '../dtos/I18nDTO.js'
import {Done, Styled, Warn} from '../lib/Output.js'
import {AddLocale} from '../lib/I18n.js'

/**
 * The commands of the messages of the languages (lakutata/com/i18n)
 */
export class I18nController extends Controller {

    @CLIAction('i18n <action> [locale]', I18nDTO, {description: 'Check the messages of the languages, declare the types of their keys, or add a language'})
    public async i18n(input: I18nDTO): Promise<undefined> {
        const directories: string[] = input.dir.split(',').map((directory: string): string => path.resolve(directory.trim())).filter(Boolean)
        const relative = (file: string): string => path.relative(process.cwd(), file) || '.'
        switch (input.action) {
            case 'check': {
                const catalogs: Catalogs = await loadCatalogs(directories)
                const issues: CatalogIssue[] = checkCatalogs(catalogs, input.default)
                for (const issue of issues) {
                    const where: string = issue.key ? `${issue.locale} ${issue.key}` : issue.locale
                    process.stdout.write(`${issue.level === 'error' ? Styled('red', '✖') : Styled('yellow', '!')} ${Styled('bold', where)}: ${issue.message}\n`)
                }
                const errors: number = issues.filter((issue: CatalogIssue): boolean => issue.level === 'error').length
                const warnings: number = issues.length - errors
                const summary: string = `${catalogs.size} language${catalogs.size === 1 ? '' : 's'} (${[...catalogs.keys()].sort().join(', ')}), ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`
                if (errors || (input.strict && warnings)) throw new Error(`The messages have problems: ${summary}`)
                Done(`Messages checked: ${summary}`)
                return undefined
            }
            case 'types': {
                const declaration: string = generateMessageTypes(await loadCatalogs(directories), input.default, input.module)
                const file: string = path.resolve(input.out)
                await mkdir(path.dirname(file), {recursive: true})
                await writeFile(file, declaration)
                Done(`Types of the messages of ${input.default} declared: ${relative(file)}`)
                return undefined
            }
            case 'add': {
                if (!input.locale) throw new Error('The language is required: lakutata i18n add <locale>')
                if (directories.length !== 1) throw new Error('A language is added to one directory (--dir)')
                const files: string[] = await AddLocale(directories[0], input.locale, input.default)
                Done(`Messages of ${input.locale} added: ${files.map(relative).join(', ')}`)
                Warn(`They are the messages of ${input.default}: translate them (lakutata i18n check tells the ones which are not)`)
                return undefined
            }
        }
    }
}
