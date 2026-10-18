//The content of the website, generated from the repository before VitePress builds it: the logo, the guides of
//packages/lakutata/doc (English and Chinese) and their examples, the READMEs of the published packages (README.md and
//README.zh-CN.md, their relative links pointed to GitHub), the guides as plain Markdown with llms.txt, the Agent Skill
//(its page and its zip) and the API reference of the subpaths of lakutata (TypeDoc, from the declarations of the built
//packages: run `npm run build` at the root of the repository first), also under /zh/api/ with a Chinese note (its text
//is the one of the declarations).
//
//  node scripts/content.mjs            everything
//  node scripts/content.mjs --no-api   the guides and the packages only (faster, while writing)
import {spawnSync} from 'node:child_process'
import {cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {Application} from 'typedoc'
import {publishedPackages} from './packages.mjs'

const WEBSITE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = resolve(WEBSITE, '..')
const SRC = join(WEBSITE, 'src')
const REPOSITORY = 'https://github.com/lakutata/lakutata'

/**
 * Empty a directory of the generated content
 * @param directory The directory.
 */
function fresh(directory) {
    rmSync(directory, {recursive: true, force: true})
    mkdirSync(directory, {recursive: true})
}

/**
 * The guides, as they are: their links are to each other, and to the examples (pointed to the examples of the website)
 */
function guides() {
    for (const [language, target, examples] of [['en', 'guide', '/examples/'], ['zh', 'zh/guide', '/zh/examples/']]) {
        const source = join(ROOT, 'packages/lakutata/doc', language)
        fresh(join(SRC, target))
        for (const file of readdirSync(source).filter((name) => name.endsWith('.md'))) {
            const content = readFileSync(join(source, file), 'utf8').replace(/\]\(examples\/([^)\s]*)\)/g, (_match, page) => `](${examples}${page === 'README.md' ? '' : page})`)
            writeFileSync(join(SRC, target, file), content)
        }
    }
}

/**
 * The examples, as they are (their README is the index), their links to the guides pointed to the guides of the website
 */
function examples() {
    for (const [language, target, guides] of [['en', 'examples', '/guide/'], ['zh', 'zh/examples', '/zh/guide/']]) {
        const source = join(ROOT, 'packages/lakutata/doc', language, 'examples')
        fresh(join(SRC, target))
        if (!existsSync(source)) continue
        for (const file of readdirSync(source).filter((name) => name.endsWith('.md'))) {
            const content = readFileSync(join(source, file), 'utf8').replace(/\]\(\.\.\/([^)\s]+)\)/g, `](${guides}$1)`)
            writeFileSync(join(SRC, target, file === 'README.md' ? 'index.md' : file), content)
        }
    }
}

/**
 * The languages of the pages of the packages: their README, the line of their README linking to the other language
 * (the website has its own switch), the section of the README of the repository listing them
 */
const PACKAGE_PAGES = [
    {target: 'packages', readme: 'README.md', switch: /^English \| \[中文\]\(README\.zh-CN\.md\)\n\n/m, title: 'Packages', section: 'Packages', repository: 'README.md'},
    {target: 'zh/packages', readme: 'README.zh-CN.md', switch: /^\[English\]\(README\.md\) \| 中文\n\n/m, title: '包列表', section: '包', repository: 'README.zh-CN.md'}
]

/**
 * A section of a README of the repository, without its heading, its links to the directories of the packages pointed
 * to their pages
 * @param file The README.
 * @param heading The heading of the section.
 */
function repositorySection(file, heading) {
    const text = readFileSync(join(ROOT, file), 'utf8')
    const start = text.indexOf(`\n## ${heading}\n`)
    if (start < 0) throw new Error(`${file} has no section "${heading}"`)
    const end = text.indexOf('\n## ', start + 1)
    return text.slice(start + heading.length + 5, end < 0 ? undefined : end).trim().replace(/\]\(packages\/([^)\s]+)\)/g, '](./$1)')
}

/**
 * The READMEs of the packages, in English and in Chinese (the English one when a package has no Chinese one), their
 * relative links pointed to the files of the repository; their lists, from the README of the repository
 */
function packages() {
    const list = publishedPackages()
    for (const language of PACKAGE_PAGES) {
        fresh(join(SRC, language.target))
        for (const manifest of list) {
            const directory = join(ROOT, 'packages', manifest.directory)
            const readme = [language.readme, 'README.md'].map((name) => join(directory, name)).find(existsSync)
            if (!readme) continue
            const content = readFileSync(readme, 'utf8')
                .replace(PACKAGE_PAGES[0].switch, '').replace(PACKAGE_PAGES[1].switch, '')
                .replace(/\]\((?!https?:|mailto:|#)([^)\s]+)\)/g, (_match, target) => `](${REPOSITORY}/blob/main/packages/${manifest.directory}/${target.replace(/^\.\//, '')})`)
            writeFileSync(join(SRC, language.target, `${manifest.directory}.md`), content)
        }
        writeFileSync(join(SRC, language.target, 'index.md'), `# ${language.title}\n\n${repositorySection(language.repository, language.section)}\n`)
    }
}

/**
 * The guides and the examples as plain Markdown, at the paths they have in the package lakutata (its doc/en/HTTP.md is
 * https://lakutata.com/doc/en/HTTP.md), for the AI assistants working on a project that has not installed it yet;
 * llms.txt and zh/llms.txt, their indexes (the guides listed by the Overview, the examples by their README); and
 * llms-full.txt and zh/llms-full.txt, all the guides of a language in one file
 */
function markdown() {
    const doc = join(ROOT, 'packages/lakutata/doc')
    fresh(join(SRC, 'public', 'doc'))
    cpSync(doc, join(SRC, 'public', 'doc'), {recursive: true})
    //The rows of the table of an index (Overview.md, examples/README.md): its pages, their titles and topics
    const rows = (language, file) => [...readFileSync(join(doc, language, file), 'utf8').matchAll(/^\| \[([^\]]+)\]\(([\w-]+\.md)\) \| (.*) \|$/gm)]
    const list = (language, file, directory) => rows(language, file).map(([, title, page, topic]) => `- [${title}](https://lakutata.com/doc/${language}/${directory}${page}): ${topic}`)
    //All the guides of a language in one file, in the order of the Overview, each after the address of its own file
    const full = (language) => ['Overview.md', ...rows(language, 'Overview.md').map(([, , page]) => page)]
        .map((page) => `Source: https://lakutata.com/doc/${language}/${page}\n\n${readFileSync(join(doc, language, page), 'utf8').trim()}\n`)
        .join('\n---\n\n')
    mkdirSync(join(SRC, 'public', 'zh'), {recursive: true})
    writeFileSync(join(SRC, 'public', 'llms-full.txt'), full('en'))
    writeFileSync(join(SRC, 'public', 'zh', 'llms-full.txt'), full('zh'))
    writeFileSync(join(SRC, 'public', 'llms.txt'), [
        '# Lakutata',
        '',
        '> An IoC application framework for Node.js and TypeScript: web services, command line tools, desktop (Electron)',
        '> applications and services on devices. The guides and the examples below are plain Markdown. The same files ship in',
        '> the npm package lakutata (node_modules/lakutata/doc/en), in the version a project has installed: those win over these,',
        '> which follow the latest sources.',
        '',
        'The Agent Skill of lakutata, for AI coding assistants: https://lakutata.com/skill/',
        '',
        'All the guides in one file: https://lakutata.com/llms-full.txt',
        '',
        '## Guides',
        '',
        '- [Overview](https://lakutata.com/doc/en/Overview.md): The subpaths of lakutata, and the list of the guides',
        ...list('en', 'Overview.md', ''),
        '',
        '## Examples',
        '',
        ...list('en', 'examples/README.md', 'examples/'),
        '',
        '## Optional',
        '',
        '- [Chinese](https://lakutata.com/zh/llms.txt): the same guides and examples in Chinese',
        ''
    ].join('\n'))
    writeFileSync(join(SRC, 'public', 'zh', 'llms.txt'), [
        '# Lakutata',
        '',
        '> 面向 Node.js 和 TypeScript 的 IoC 应用框架：Web 服务、命令行工具、桌面（Electron）应用和设备上的服务。下面的指南和示例都是 Markdown 原文。同样的文件也随 npm 包 lakutata 发布（node_modules/lakutata/doc/zh），版本和项目安装的版本一致；两者都有时以已安装的包为准，这里的文件跟随最新的源码。',
        '',
        '供 AI 编程助手使用的 lakutata 技能：https://lakutata.com/zh/skill/',
        '',
        '所有指南合在一个文件中：https://lakutata.com/zh/llms-full.txt',
        '',
        '## 指南',
        '',
        '- [Overview](https://lakutata.com/doc/zh/Overview.md): lakutata 的子路径和指南列表',
        ...list('zh', 'Overview.md', ''),
        '',
        '## 示例',
        '',
        ...list('zh', 'examples/README.md', 'examples/'),
        '',
        '## Optional',
        '',
        '- [English](https://lakutata.com/llms.txt): 英文版的指南和示例',
        ''
    ].join('\n'))
}

/**
 * The page of the Agent Skill (the README of its plugin, in English and in Chinese, its relative links pointed to the
 * files of the repository) and the skill as a zip of its folder, to upload to the Claude apps
 */
function skill() {
    const plugin = join(ROOT, 'plugins/lakutata')
    for (const language of PACKAGE_PAGES) {
        const target = join(SRC, language.target.replace('packages', 'skill'))
        fresh(target)
        const content = readFileSync(join(plugin, language.readme), 'utf8')
            .replace(PACKAGE_PAGES[0].switch, '').replace(PACKAGE_PAGES[1].switch, '')
            .replace(/\]\((?!https?:|mailto:|#)([^)\s]+)\)/g, (_match, link) => `](${REPOSITORY}/tree/main/plugins/lakutata/${link.replace(/^\.\//, '')})`)
        writeFileSync(join(target, 'index.md'), content)
    }
    const zip = join(SRC, 'public', 'lakutata-skill.zip')
    rmSync(zip, {force: true})
    const packed = spawnSync('zip', ['-r', '-X', '-q', zip, 'lakutata', '-x', '*.DS_Store'], {cwd: join(plugin, 'skills'), stdio: 'inherit'})
    if (packed.status !== 0) throw new Error('zip could not pack the skill')
}

/**
 * The API reference of the subpaths of lakutata, one module each (the TypeORM subpaths left to typeorm.io)
 */
async function api() {
    const umbrella = join(ROOT, 'packages/lakutata')
    const manifest = JSON.parse(readFileSync(join(umbrella, 'package.json'), 'utf8'))
    const entries = join(WEBSITE, '.api')
    fresh(entries)
    fresh(join(SRC, 'api'))
    const entryPoints = []
    for (const [subpath, target] of Object.entries(manifest.exports)) {
        const types = target?.import?.types
        if (!types || subpath === './orm' || subpath === './decorator/orm') continue
        const declarations = join(umbrella, types)
        if (!existsSync(declarations)) throw new Error(`${declarations} is missing: run "npm run build" at the root of the repository first`)
        const name = subpath === '.' ? 'lakutata' : `lakutata/${subpath.slice(2)}`
        const file = join(entries, `${name.replace(/\//g, '__')}.ts`)
        //A module named after its subpath
        writeFileSync(file, `/**\n * @module ${name}\n */\nexport * from '${declarations.replace(/\.d\.ts$/, '.js')}'\n`)
        entryPoints.push(file)
    }
    writeFileSync(join(entries, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            skipLibCheck: true,
            types: ['node'],
            typeRoots: [join(ROOT, 'node_modules/@types')]
        },
        include: ['*.ts']
    }, null, 2))
    const application = await Application.bootstrapWithPlugins({
        entryPoints: entryPoints,
        tsconfig: join(entries, 'tsconfig.json'),
        plugin: ['typedoc-plugin-markdown', 'typedoc-vitepress-theme'],
        out: join(SRC, 'api'),
        docsRoot: SRC,
        name: 'API Reference',
        readme: 'none',
        entryFileName: 'index.md',
        excludePrivate: true,
        excludeProtected: true,
        excludeInternal: true,
        disableSources: true,
        skipErrorChecking: true,
        hidePageHeader: true,
        hideBreadcrumbs: true,
        sort: ['kind', 'alphabetical'],
        sidebar: {autoConfiguration: true, format: 'vitepress', pretty: false, collapsed: true},
        logLevel: 'Warn'
    })
    const project = await application.convert()
    if (!project) throw new Error('TypeDoc could not read the declarations')
    await application.generateOutputs(project)
    //The same pages in the Chinese website (their links are relative), a note under their title
    const chinese = join(SRC, 'zh', 'api')
    fresh(chinese)
    cpSync(join(SRC, 'api'), chinese, {recursive: true, filter: (file) => !file.endsWith('typedoc-sidebar.json')})
    const note = (directory) => {
        for (const entry of readdirSync(directory, {withFileTypes: true})) {
            const file = join(directory, entry.name)
            if (entry.isDirectory()) note(file)
            else if (entry.name.endsWith('.md')) writeFileSync(file, readFileSync(file, 'utf8').replace(/^(# .*\n)/m, '$1\n::: info 说明\n本页由源码中的注释生成，内容为英文。\n:::\n'))
        }
    }
    note(chinese)
}

/**
 * The logo of the framework, served as the logo and the icon of the website
 */
function logo() {
    mkdirSync(join(SRC, 'public'), {recursive: true})
    writeFileSync(join(SRC, 'public', 'logo.svg'), readFileSync(join(ROOT, 'packages/lakutata/assets/logo.svg')))
}

logo()
guides()
examples()
packages()
markdown()
skill()
if (!process.argv.includes('--no-api')) await api()
