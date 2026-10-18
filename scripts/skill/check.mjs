//Check the Agent Skill of the framework (plugins/lakutata/skills/lakutata), published by the plugin marketplace of the
//repository (.claude-plugin/marketplace.json) and by the website (a zip): its frontmatter as the Agent Skills
//specification defines it (the fields every tool accepts only), the length of SKILL.md, its links (the files of the
//skill, the guides and examples of lakutata.com), the manifests of the plugin, and its TypeScript blocks compiled
//against the built typings (npm run build first), with the compiler options of the applications (the tsconfig.json
//published by lakutata), each block a module of its own. A block that is not meant to compile is not a typescript block.
//
//  node scripts/skill/check.mjs                      the skill
//  node scripts/skill/check.mjs --files <file.md...>  the links and the blocks of some Markdown files only (a draft)
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PLUGIN = path.join(ROOT, 'plugins', 'lakutata')
const SKILL = path.join(PLUGIN, 'skills', 'lakutata')
const GUIDES = path.join(ROOT, 'packages', 'lakutata', 'doc', 'en')
//A directory of each run, as the check of the API documentation
const EXAMPLES = path.join(ROOT, 'consumer-fixture', '.examples', `skill-${process.pid}`)
//The fields of the frontmatter that every tool reading Agent Skills accepts (claude.ai and the API refuse the others)
const FIELDS = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']

const failures = []
//The Markdown files given, checked instead of the skill (their links resolved as if they were in references/)
const given = process.argv.includes('--files') ? process.argv.slice(process.argv.indexOf('--files') + 1).map(file => path.resolve(file)) : undefined

/**
 * The Markdown files of the skill, by their path in it
 */
function markdownFiles(directory, prefix = '') {
    return readdirSync(directory, {withFileTypes: true}).flatMap(entry => entry.isDirectory()
        ? markdownFiles(path.join(directory, entry.name), `${prefix}${entry.name}/`)
        : entry.name.endsWith('.md') ? [`${prefix}${entry.name}`] : [])
}

/**
 * The frontmatter of SKILL.md: its top-level fields and their values (the folded and nested ones as their text)
 */
function frontmatter(text) {
    const match = /^---\n([\s\S]*?)\n---\n/.exec(text)
    if (!match) return undefined
    const fields = new Map()
    let current
    for (const line of match[1].split('\n')) {
        const field = /^([\w-]+):\s*(.*)$/.exec(line)
        if (field) {
            current = field[1]
            fields.set(current, field[2] === '>-' || field[2] === '|' ? '' : field[2])
        } else if (current && /^\s+/.test(line)) {
            fields.set(current, `${fields.get(current)} ${line.trim()}`.trim())
        }
    }
    return fields
}

const skill = existsSync(path.join(SKILL, 'SKILL.md')) ? readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8') : ''
const fields = frontmatter(skill)
if (given) {
    //A draft: its links and its blocks only
} else if (!fields) {
    failures.push('SKILL.md: no frontmatter')
} else {
    for (const field of fields.keys()) if (!FIELDS.includes(field)) failures.push(`SKILL.md: the field ${field} is not one of ${FIELDS.join(', ')}`)
    const name = fields.get('name') ?? ''
    if (name !== path.basename(SKILL)) failures.push(`SKILL.md: the name "${name}" is not the name of its directory`)
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64) failures.push(`SKILL.md: the name "${name}" is not 1-64 lowercase letters, digits and hyphens`)
    const description = fields.get('description') ?? ''
    if (!description || description.length > 1024) failures.push(`SKILL.md: the description has ${description.length} characters (1-1024)`)
    if ((fields.get('compatibility') ?? '').length > 500) failures.push('SKILL.md: the compatibility has more than 500 characters')
}
const lines = skill.split('\n').length
//The guides SKILL.md sends to (`HTTP.md`, `examples/README.md`): files of the guides of the current version
if (!given) for (const [, guide] of skill.matchAll(/`((?:examples\/)?[A-Z][\w-]*\.md)`/g)) if (!existsSync(path.join(GUIDES, guide))) failures.push(`SKILL.md: the guide ${guide} does not exist`)
//The guides it gives by their address on the website (https://lakutata.com/doc/en/HTTP.md is doc/en/HTTP.md)
if (!given) for (const [address, guide] of skill.matchAll(/https:\/\/lakutata\.com\/doc\/en\/([\w/-]+\.md)/g)) if (!existsSync(path.join(GUIDES, guide))) failures.push(`SKILL.md: ${address} is no file of the guides`)
if (!given && lines > 500) failures.push(`SKILL.md: ${lines} lines (500 at most)`)

//The manifests of the plugin and of the marketplace
if (!given) {
    const marketplace = JSON.parse(readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'))
    const plugin = JSON.parse(readFileSync(path.join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'))
    const entry = marketplace.plugins?.find(item => item.name === plugin.name)
    if (!entry) failures.push(`marketplace.json: no plugin named ${plugin.name}`)
    else if (path.resolve(ROOT, entry.source) !== PLUGIN) failures.push(`marketplace.json: the source of ${plugin.name} is not plugins/lakutata`)
}

//The links: the files of the skill, the guides and the examples of the website
const blocks = []
for (const file of given ?? markdownFiles(SKILL)) {
    const text = readFileSync(given ? file : path.join(SKILL, file), 'utf8')
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        const site = /^https:\/\/lakutata\.com\/(guide|examples)\/([\w-]+)(#[\w-]+)?$/.exec(target)
        if (site) {
            if (!existsSync(path.join(GUIDES, site[1] === 'examples' ? 'examples' : '', `${site[2]}.md`))) failures.push(`${file}: the page of ${target} does not exist`)
        } else if (!/^https?:\/\//.test(target) && !target.startsWith('#')) {
            const from = given ? path.join(SKILL, 'references') : path.join(SKILL, path.dirname(file))
            if (!existsSync(path.join(from, target.split('#')[0]))) failures.push(`${file}: the link ${target} leads to no file of the skill`)
        }
    }
    let index = 0
    for (const match of text.matchAll(/^```(?:typescript|ts)\n([\s\S]*?)^```/gm)) blocks.push({file, index: ++index, code: match[1]})
}

//The TypeScript blocks
rmSync(EXAMPLES, {recursive: true, force: true})
mkdirSync(EXAMPLES, {recursive: true})
const modules = new Map()
for (const block of blocks) {
    //.mts: an ES module (its top-level await) whatever the package.json around it
    const module = path.join(EXAMPLES, `${path.basename(block.file).replace(/\W+/g, '-')}-${block.index}.mts`)
    writeFileSync(module, `${block.code}\nexport {}\n`)
    modules.set(module, block)
}
const applications = ts.getParsedCommandLineOfConfigFile(path.join(ROOT, 'packages', 'lakutata', 'tsconfig.base.json'), {}, {...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined})
const program = ts.createProgram([...modules.keys()], {...applications.options, types: ['node'], noEmit: true})
for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    const block = diagnostic.file && modules.get(diagnostic.file.fileName)
    if (!block) continue
    const {line} = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
    failures.push(`${block.file}: block ${block.index} does not compile (its line ${line + 1}): ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`)
}
rmSync(EXAMPLES, {recursive: true, force: true})

for (const failure of failures) console.error(`✖ ${failure}`)
if (failures.length) process.exit(1)
console.log(given ? `${blocks.length} TypeScript blocks compile, the links lead to pages.` : `The skill checks: ${lines} lines in SKILL.md, ${blocks.length} TypeScript blocks compile.`)
