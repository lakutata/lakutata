import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {applyFeatureBlocks, mergeJson} from '../lib/TemplateFeatures.js'
import {CLI, runIn} from './support/Workspace.js'

let work: string

/**
 * Write files
 * @param directory
 * @param files the files, by path relative to the directory
 */
function listFiles(directory: string, files: Record<string, unknown>): void {
    for (const [file, content] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(directory, file)), {recursive: true})
        writeFileSync(path.join(directory, file), typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`)
    }
}

describe('The features of the templates', (): void => {
    before((): void => {
        work = realpathSync(mkdtempSync(path.join(tmpdir(), 'lakutata-features-')))
    })

    after((): void => rmSync(work, {recursive: true, force: true}))

    it('keep or remove their blocks, the markers removed, in the comments of the languages', (): void => {
        const text: string = [
            'import a',
            '//@if i18n',
            'import i18n',
            '//@end',
            '    // @if !i18n',
            '    plain()',
            '    // @else',
            '    translated()',
            '    // @end',
            '# @if docker',
            'docker: true',
            '#@if i18n',
            'nested: true',
            '#@end',
            '# @end',
            '<!--@if i18n-->',
            '<p>i18n</p>',
            '<!-- @end -->',
            '/* @if i18n */',
            'css()',
            '/* @end */',
            'end'
        ].join('\n')
        assert.strictEqual(applyFeatureBlocks(text, new Set(['i18n']), 'a.ts'), ['import a', 'import i18n', '    translated()', '<p>i18n</p>', 'css()', 'end'].join('\n'))
        assert.strictEqual(applyFeatureBlocks(text, new Set(['docker']), 'a.ts'), ['import a', '    plain()', 'docker: true', 'end'].join('\n'))
        assert.strictEqual(applyFeatureBlocks(text, new Set(['docker', 'i18n']), 'a.ts'), ['import a', 'import i18n', '    translated()', 'docker: true', 'nested: true', '<p>i18n</p>', 'css()', 'end'].join('\n'))
        //A text without blocks, a text telling of @if in another way
        assert.strictEqual(applyFeatureBlocks('const a = "//@if i18n"\n', new Set(), 'a.ts'), 'const a = "//@if i18n"\n')
        assert.throws((): unknown => applyFeatureBlocks('a\n//@if i18n\nb', new Set(), 'src/App.ts'), /^Error: src\/App\.ts:2: @if without its @end/)
        assert.throws((): unknown => applyFeatureBlocks('//@end', new Set(), 'a.ts'), /a\.ts:1: @end without its @if/)
        assert.throws((): unknown => applyFeatureBlocks('//@if i18n\n//@else\n//@else\n//@end', new Set(), 'a.ts'), /a\.ts:3: @else without its @if/)
        assert.throws((): unknown => applyFeatureBlocks('//@if\n//@end', new Set(), 'a.ts'), /a\.ts:1: @if needs a feature/)
    })

    it('merge their JSON files into the ones of the project', (): void => {
        assert.deepStrictEqual(mergeJson({scripts: {build: 'tsc'}, compilerOptions: {strict: true, lib: ['ES2022']}, name: 'a'}, {scripts: {'i18n:check': 'lakutata i18n check'}, compilerOptions: {resolveJsonModule: true, lib: ['ES2023']}}), {
            scripts: {build: 'tsc', 'i18n:check': 'lakutata i18n check'},
            compilerOptions: {strict: true, lib: ['ES2023'], resolveJsonModule: true},
            name: 'a'
        })
    })

    it('are enabled by lakutata create --with, their files added, their blocks kept; the others removed', async (): Promise<void> => {
        const template: string = path.join(work, 'template-demo')
        listFiles(template, {
            'package.json': {name: 'template-demo', lakutata: {template: 'demo', features: {i18n: 'Messages in several languages'}}},
            'template/package.json': {name: '{$APP_ID}', scripts: {build: 'tsc'}},
            'template/_gitignore': 'node_modules\n',
            'template/src/App.ts': 'export const name: string = \'{$APP_NAME}\'\n//@if i18n\nexport const languages: string[] = [\'en\', \'zh-CN\']\n//@end\n',
            'features/i18n/package.json': {scripts: {'i18n:check': 'lakutata i18n check --dir src/locales'}},
            'features/i18n/src/locales/en.json': {app: {name: '{$APP_NAME}'}}
        })
        const created = await runIn(process.execPath, [CLI, 'create', '--name', 'Shop', '--template', template, '--with', 'i18n', '--package-manager', 'none', '--no-git', '--yes'], work)
        assert.strictEqual(created.code, 0, created.output)
        assert.match(created.output, /Features\s+i18n/)
        assert.match(created.output, /copied \(4 files, with i18n\)/)
        const project: string = path.join(work, 'Shop')
        assert.strictEqual(readFileSync(path.join(project, 'src', 'App.ts'), 'utf8'), 'export const name: string = \'Shop\'\nexport const languages: string[] = [\'en\', \'zh-CN\']\n')
        assert.deepStrictEqual(JSON.parse(readFileSync(path.join(project, 'package.json'), 'utf8')), {name: 'shop', scripts: {build: 'tsc', 'i18n:check': 'lakutata i18n check --dir src/locales'}})
        assert.deepStrictEqual(JSON.parse(readFileSync(path.join(project, 'src', 'locales', 'en.json'), 'utf8')), {app: {name: 'Shop'}})
        assert.ok(existsSync(path.join(project, '.gitignore')))
        //Without the feature
        const plain = await runIn(process.execPath, [CLI, 'create', '--name', 'Plain', '--template', template, '--package-manager', 'none', '--no-git', '--yes'], work)
        assert.strictEqual(plain.code, 0, plain.output)
        assert.match(plain.output, /Features\s+none/)
        assert.strictEqual(readFileSync(path.join(work, 'Plain', 'src', 'App.ts'), 'utf8'), 'export const name: string = \'Plain\'\n')
        assert.ok(!existsSync(path.join(work, 'Plain', 'src', 'locales')))
        assert.deepStrictEqual(JSON.parse(readFileSync(path.join(work, 'Plain', 'package.json'), 'utf8')).scripts, {build: 'tsc'})
        //A feature the template has not
        const unknown = await runIn(process.execPath, [CLI, 'create', '--name', 'Other', '--template', template, '--with', 'docker', '--package-manager', 'none', '--no-git', '--yes'], work)
        assert.notStrictEqual(unknown.code, 0)
        assert.match(unknown.output, /The template has no feature docker \(its features: i18n\)/)
        assert.ok(!existsSync(path.join(work, 'Other')))
    })
})
