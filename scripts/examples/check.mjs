//Check the example pages (packages/lakutata/doc/en/examples): each one is made into its project, from the templates and
//the command line tool of the repository, its files written as the page gives them, and the steps of its check run
//(a build, its tests...). The Chinese page of an example must give the same code (its comments translated).
//
//  node scripts/examples/check.mjs                 every example
//  node scripts/examples/check.mjs RestAPI         some of them
//  node scripts/examples/check.mjs --keep RestAPI  keep the projects (their directories are printed)
//
//A page ends with its check, in a comment:
//
//  <!--
//  check:
//    create: <name> <template> [features...]
//    remove: <files of the template...>
//    run: <command, run in the project>
//  -->
//
//Its files are the code blocks after a line holding their path only: **`packages/app/src/App.ts`**. A page of several
//projects creates each of them; its files and the files it removes start with the name of their project
//(**`orders/packages/app/src/App.ts`**), and its commands with the project they run in (run: orders: npm test). The
//node_modules of a project link the packages of the repository and those of its own workspace, as an install would:
//build the packages first (npm run build), nothing is installed. Run the checks one after the other: the tests of the
//projects listen on their ports.
import {spawnSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PAGES = join(ROOT, 'packages/lakutata/doc')
const CLI = join(ROOT, 'packages/cli/dist/esm/CLIApp.js')

/**
 * The files of a page: the code blocks after a line holding their path
 * @param text The page.
 */
function pageFiles(text) {
    const files = new Map()
    for (const match of text.matchAll(/^\*\*`([^`]+)`\*\*\n\n```[a-z]*\n([\s\S]*?)\n```$/gm)) files.set(match[1], `${match[2]}\n`)
    return files
}

/**
 * The check of a page
 * @param text The page.
 * @param page Its name.
 */
function pageCheck(text, page) {
    const comment = /<!--\s*\ncheck:\n([\s\S]*?)-->/.exec(text)
    if (!comment) throw new Error(`${page} has no check`)
    const steps = comment[1].split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
        const [, action, value] = /^(create|remove|run):\s*(.*)$/.exec(line) ?? []
        if (!action) throw new Error(`${page}: the step "${line}" is not create, remove or run`)
        return {action, value}
    })
    if (steps[0]?.action !== 'create') throw new Error(`${page}: the check starts by creating the project`)
    return steps
}

/**
 * The code of a file without its comments (translated in the Chinese pages): its documentation comments, its comments
 * of a line, and the comments at the end of its lines
 * @param code The code.
 */
function withoutComments(code) {
    return code.replace(/^\s*\/\*\*[\s\S]*?\*\/\n/gm, '').split('\n').filter((line) => !/^\s*(\/\/|#)/.test(line)).map((line) => line.replace(/\s+(\/\/|#)[^'"`]*$/, '')).join('\n')
}

/**
 * The node_modules of a project, as an install makes them: links to the packages of the repository, and to the packages
 * of the workspace of the project, which import each other (ui, resources…)
 * @param project The directory of the project.
 */
function linkModules(project) {
    const modules = join(project, 'node_modules')
    const repository = join(ROOT, 'node_modules')
    const own = new Map()
    const packages = join(project, 'packages')
    if (existsSync(packages)) {
        for (const directory of readdirSync(packages)) {
            const manifest = join(packages, directory, 'package.json')
            if (existsSync(manifest)) own.set(JSON.parse(readFileSync(manifest, 'utf8')).name, join(packages, directory))
        }
    }
    const scopes = new Set([...own.keys()].filter((name) => name.startsWith('@')).map((name) => name.split('/')[0]))
    mkdirSync(modules)
    for (const entry of readdirSync(repository)) {
        if (own.has(entry)) continue
        if (!scopes.has(entry)) {
            symlinkSync(join(repository, entry), join(modules, entry), 'dir')
            continue
        }
        //A scope shared with the workspace: its packages one by one
        mkdirSync(join(modules, entry))
        for (const child of readdirSync(join(repository, entry))) if (!own.has(`${entry}/${child}`)) symlinkSync(join(repository, entry, child), join(modules, entry, child), 'dir')
    }
    for (const [name, directory] of own) {
        mkdirSync(dirname(join(modules, name)), {recursive: true})
        symlinkSync(directory, join(modules, name), 'dir')
    }
}

/**
 * Run a command in a directory, its output kept
 * @param command The command line.
 * @param cwd The directory.
 */
function run(command, cwd) {
    const result = spawnSync(command, {cwd, shell: true, encoding: 'utf8', env: {...process.env, LAKUTATA_LANG: 'en', NO_COLOR: '1'}, maxBuffer: 64 * 1024 * 1024})
    if (result.status !== 0) throw new Error(`"${command}" failed (${result.status}):\n${`${result.stdout}${result.stderr}`.trim().split('\n').slice(-30).join('\n')}`)
    return result.stdout
}

/**
 * Check an example
 * @param page The name of the page.
 * @param keep Whether its project is kept.
 */
function check(page, keep) {
    const text = readFileSync(join(PAGES, 'en', 'examples', `${page}.md`), 'utf8')
    const files = pageFiles(text)
    const steps = pageCheck(text, page)
    //The Chinese page gives the same files and the same code
    const chinese = join(PAGES, 'zh', 'examples', `${page}.md`)
    if (existsSync(chinese)) {
        const translated = pageFiles(readFileSync(chinese, 'utf8'))
        if ([...translated.keys()].join() !== [...files.keys()].join()) throw new Error(`${page}: the Chinese page gives other files (${[...translated.keys()].join(', ')})`)
        for (const [file, code] of files) if (withoutComments(code) !== withoutComments(translated.get(file))) throw new Error(`${page}: the code of ${file} differs in the Chinese page`)
    }
    const work = mkdtempSync(join(tmpdir(), `lakutata-example-${page}-`))
    //Several projects: the paths start with their names
    const several = steps.filter((step) => step.action === 'create').length > 1
    const projects = []
    const locate = (path) => several ? join(work, path) : join(projects[0], path)
    try {
        for (const step of steps) {
            if (step.action === 'create') {
                const [name, template, ...features] = step.value.split(/\s+/)
                run(`node "${CLI}" create --name ${name} --template "${join(ROOT, 'packages', `template-${template}`)}" --path "${work}" --package-manager none --no-git --yes${features.length ? ` --with ${features.join(',')}` : ''}`, work)
                projects.push(join(work, name))
                linkModules(join(work, name))
                for (const [file, code] of files) {
                    if (several && !file.startsWith(`${name}/`)) continue
                    mkdirSync(dirname(locate(file)), {recursive: true})
                    writeFileSync(locate(file), code)
                }
            } else if (step.action === 'remove') {
                for (const file of step.value.split(/\s+/)) {
                    if (!existsSync(locate(file))) throw new Error(`${page}: ${file} is not a file of the template`)
                    rmSync(locate(file))
                }
            } else {
                const [, name, command] = /^([\w-]+):\s+(.*)$/.exec(step.value) ?? []
                const directory = name && projects.includes(join(work, name)) ? join(work, name) : projects[0]
                run(name && directory === join(work, name) ? command : step.value, directory)
            }
        }
        console.log(`✔ ${page}: ${files.size} files, ${steps.length} steps${keep ? ` (${work})` : ''}`)
    } finally {
        if (!keep) rmSync(work, {recursive: true, force: true})
    }
}

const keep = process.argv.includes('--keep')
const wanted = process.argv.slice(2).filter((arg) => arg !== '--keep')
const pages = wanted.length ? wanted : readdirSync(join(PAGES, 'en', 'examples')).filter((name) => name.endsWith('.md') && name !== 'README.md').map((name) => name.slice(0, -3))
let failed = 0
for (const page of pages) {
    try {
        check(page, keep)
    } catch (error) {
        failed++
        console.error(`✖ ${page}: ${error.message}`)
    }
}
process.exit(failed ? 1 : 0)
