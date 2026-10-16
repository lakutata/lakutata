//The content of the website, generated from the repository before VitePress builds it: the logo, the guides of
//packages/lakutata/doc (English and Chinese), the READMEs of the published packages (their relative links pointed to
//GitHub) and the API reference of the subpaths of lakutata (TypeDoc, from the declarations of the built packages: run
//`npm run build` at the root of the repository first).
//
//  node scripts/content.mjs            everything
//  node scripts/content.mjs --no-api   the guides and the packages only (faster, while writing)
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
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
 * The guides, as they are: their links are to each other
 */
function guides() {
    for (const [language, target] of [['en', 'guide'], ['zh', 'zh/guide']]) {
        const source = join(ROOT, 'packages/lakutata/doc', language)
        fresh(join(SRC, target))
        for (const file of readdirSync(source).filter((name) => name.endsWith('.md')))
            writeFileSync(join(SRC, target, file), readFileSync(join(source, file), 'utf8'))
    }
}

/**
 * The READMEs of the packages, their relative links pointed to the files of the repository
 */
function packages() {
    fresh(join(SRC, 'packages'))
    const list = publishedPackages()
    for (const manifest of list) {
        const readme = join(ROOT, 'packages', manifest.directory, 'README.md')
        if (!existsSync(readme)) continue
        const content = readFileSync(readme, 'utf8').replace(/\]\((?!https?:|mailto:|#)([^)\s]+)\)/g, (_match, target) => `](${REPOSITORY}/blob/main/packages/${manifest.directory}/${target.replace(/^\.\//, '')})`)
        writeFileSync(join(SRC, 'packages', `${manifest.directory}.md`), content)
    }
    const rows = list.map((manifest) => `| [${manifest.name}](./${manifest.directory}) | ${(manifest.description ?? '').replace(/\|/g, '\\|')} |`)
    writeFileSync(join(SRC, 'packages', 'index.md'), [
        '# Packages',
        '',
        'The framework is a set of packages. `lakutata` re-exports all of them under its subpaths, and each can also be',
        'installed on its own.',
        '',
        '| Package | Description |',
        '|---|---|',
        ...rows,
        ''
    ].join('\n'))
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
packages()
if (!process.argv.includes('--no-api')) await api()
