import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {ROOT, Run} from './support/Workspace.js'

const CLI: string = path.join(ROOT, 'packages', 'cli', 'dist', 'esm', 'CLIApp.js')

let work: string

/**
 * Run the tool
 * @param args
 * @param cwd
 */
function Lakutata(args: string[], cwd: string): Promise<{ code: number, output: string }> {
    return Run(process.execPath, [CLI, ...args], cwd)
}

/**
 * A project with its messages
 * @param name
 * @param files the files, by path relative to the project
 */
function Project(name: string, files: Record<string, unknown>): string {
    const directory: string = path.join(work, name)
    for (const [file, content] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(directory, file)), {recursive: true})
        writeFileSync(path.join(directory, file), typeof content === 'string' ? content : JSON.stringify(content, null, 2))
    }
    return directory
}

describe('lakutata i18n', (): void => {
    before((): void => {
        work = realpathSync(mkdtempSync(path.join(tmpdir(), 'lakutata-i18n-')))
    })

    after((): void => rmSync(work, {recursive: true, force: true}))

    it('adds a language made of the default one, without its validation messages, then checks the messages', async (): Promise<void> => {
        const project: string = Project('shop', {
            'locales/en.json': {order: {count: '{count, plural, one {# order} other {# orders}}', created: 'Order created for {customer}'}, validation: {any: {required: '{{#label}} is needed'}}}
        })
        const added = await Lakutata(['i18n', 'add', 'zh_CN'], project)
        assert.strictEqual(added.code, 0, added.output)
        assert.match(added.output, /Messages of zh_CN added: locales[\\/]zh-CN\.json/)
        assert.match(added.output, /They are the messages of en: translate them/)
        assert.deepStrictEqual(JSON.parse(readFileSync(path.join(project, 'locales', 'zh-CN.json'), 'utf8')), {order: {count: '{count, plural, one {# order} other {# orders}}', created: 'Order created for {customer}'}})
        //Not translated yet: warnings, which fail the strict check only
        const checked = await Lakutata(['i18n', 'check'], project)
        assert.strictEqual(checked.code, 0, checked.output)
        assert.match(checked.output, /! zh-CN order\.count: The message is the one of en \(not translated yet\?\)/)
        assert.match(checked.output, /Messages checked: 2 languages \(en, zh-CN\), 0 errors, 2 warnings/)
        const strict = await Lakutata(['i18n', 'check', '--strict'], project)
        assert.notStrictEqual(strict.code, 0)
        assert.match(strict.output, /The messages have problems: 2 languages \(en, zh-CN\), 0 errors, 2 warnings/)
        //Translated, one with an error
        writeFileSync(path.join(project, 'locales', 'zh-CN.json'), JSON.stringify({order: {count: '{count, plural, other {共 # 个订单}}', created: '已为 {client} 创建订单'}}))
        const failed = await Lakutata(['i18n', 'check'], project)
        assert.notStrictEqual(failed.code, 0)
        assert.match(failed.output, /✖ zh-CN order\.created: The argument client of the message is not given to the message of en/)
        assert.match(failed.output, /! zh-CN order\.created: The argument customer of the message of en is not used/)
        //The language exists already, the default language, an invalid tag
        assert.match((await Lakutata(['i18n', 'add', 'zh-CN'], project)).output, /The messages of zh-CN exist already/)
        assert.match((await Lakutata(['i18n', 'add', 'en'], project)).output, /en is the default language/)
        assert.match((await Lakutata(['i18n', 'add', 'not a tag'], project)).output, /"not a tag" is not the tag of a language/)
        assert.match((await Lakutata(['i18n', 'add'], project)).output, /The language is required: lakutata i18n add <locale>/)
    })

    it('adds a language to the directories of the languages, and checks several directories', async (): Promise<void> => {
        const project: string = Project('admin', {
            'src/locales/en/order.json': {count: '{count} orders'},
            'src/locales/en/admin/user.json': {title: 'Users'},
            'src/locales/en/validation.json': {any: {required: '{{#label}} is needed'}},
            'shared/en.json': {app: {name: 'Shop'}}
        })
        const added = await Lakutata(['i18n', 'add', 'ja', '--dir', 'src/locales'], project)
        assert.strictEqual(added.code, 0, added.output)
        assert.ok(existsSync(path.join(project, 'src/locales/ja/order.json')) && existsSync(path.join(project, 'src/locales/ja/admin/user.json')))
        assert.ok(!existsSync(path.join(project, 'src/locales/ja/validation.json')))
        const checked = await Lakutata(['i18n', 'check', '--dir', 'src/locales,shared'], project)
        assert.strictEqual(checked.code, 0, checked.output)
        assert.match(checked.output, /! ja app\.name: The message is missing/)
        assert.match(checked.output, /2 languages \(en, ja\), 0 errors, 3 warnings/)
        assert.match((await Lakutata(['i18n', 'add', 'ko', '--dir', 'src/locales,shared'], project)).output, /A language is added to one directory/)
        assert.match((await Lakutata(['i18n', 'check', '--default', 'fr'], project)).output, /the directory of the messages does not exist/)
    })

    it('declares the types of the keys of the messages, which TypeScript checks', async (): Promise<void> => {
        const project: string = Project('typed', {
            'locales/en.json': {order: {count: '{count, plural, one {# order} other {# orders}}', created: 'Order created for {customer}'}},
            'src/App.ts': `import {type I18n} from 'lakutata/com/i18n'

declare const i18n: I18n
i18n.t('order.count', {count: 1})
i18n.t('order.created', {customer: 'Ada'}, 'zh-CN')
// @ts-expect-error a key misspelled
i18n.t('order.cuont', {count: 1})
// @ts-expect-error an argument missing
i18n.t('order.count', {})
`,
            'tsconfig.json': {compilerOptions: {module: 'Node16', moduleResolution: 'Node16', target: 'ES2022', strict: true, noEmit: true, skipLibCheck: true, experimentalDecorators: true}, include: ['src']}
        })
        mkdirSync(path.join(project, 'node_modules'))
        symlinkSync(path.join(ROOT, 'packages', 'lakutata'), path.join(project, 'node_modules', 'lakutata'), 'dir')
        const typed = await Lakutata(['i18n', 'types'], project)
        assert.strictEqual(typed.code, 0, typed.output)
        assert.match(typed.output, /Types of the messages of en declared: src[\\/]i18n\.d\.ts/)
        assert.match(readFileSync(path.join(project, 'src', 'i18n.d.ts'), 'utf8'), /'order\.count': \{ count: number \}/)
        const compiled = await Run(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'], project)
        assert.strictEqual(compiled.code, 0, compiled.output)
        //Without the declaration, the mistakes compile: the expected errors are unused
        rmSync(path.join(project, 'src', 'i18n.d.ts'))
        const untyped = await Run(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'], project)
        assert.match(untyped.output, /Unused '@ts-expect-error' directive/)
    })
})
