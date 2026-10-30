// Compares apis.mjs with the documentation of Node.js (all.json): the versions adding each entry of the documentation
// (source node), and the APIs of the documentation the targets lack that no entry mentions yet, to review (most of them
// are never used by the packages: the command line, the test runner, the errors, Node-API). apis.mjs is edited by hand.
//
// Run: node scripts/node-compat/refresh.mjs [--docs <file or URL of all.json>] [--candidates]
// --docs defaults to the documentation of the latest Node.js 24; --candidates lists the APIs no entry mentions

import {readFileSync} from 'node:fs'
import {parseArgs} from 'node:util'
import {APIS, TARGETS, available} from './apis.mjs'

const {values: args} = parseArgs({
    options: {
        docs: {type: 'string', default: 'https://nodejs.org/docs/latest-v24.x/api/all.json'},
        candidates: {type: 'boolean', default: false}
    }
})

const docs = /^https?:/.test(args.docs) ? await (await fetch(args.docs)).json() : JSON.parse(readFileSync(args.docs, 'utf8'))

/**
 * The entries of the documentation adding an API: their name (the last code of their title) and their versions
 */
const documented = []
const walk = (node, trail) => {
    if (Array.isArray(node)) return node.forEach(child => walk(child, trail))
    if (!node || typeof node !== 'object') return
    const title = node.textRaw?.replace(/\s+/g, ' ')
    const here = title ? [...trail, title] : trail
    const added = [].concat(node.meta?.added ?? []).filter(version => /^v\d+\.\d+\.\d+$/.test(version))
    if (added.length && title) {
        const code = [...title.matchAll(/`([^`]+)`/g)].pop()?.[1]
        if (code) documented.push({title: here.slice(-2).join(' > '), name: code.replace(/[([].*$/, '').trim(), added})
    }
    for (const key of Object.keys(node)) if (typeof node[key] === 'object') walk(node[key], here)
}
walk(docs, [])

const last = name => name.split('.').pop()
let differences = 0
for (const entry of APIS.filter(api => api.source === 'node' && !api.change)) {
    const matches = documented.filter(doc => doc.name === entry.api || (entry.api.includes('.') && doc.name.endsWith(`.${last(entry.api)}`) && doc.name.split('.')[0].toLowerCase() === entry.api.split('.')[0].toLowerCase()))
    if (!matches.length) continue
    const same = matches.some(doc => doc.added.join(',') === entry.added.join(','))
    if (!same) {
        differences++
        console.log(`${entry.api}: apis.mjs ${entry.added.join(', ')}; documentation ${matches.map(doc => `${doc.name} ${doc.added.join(', ')}`).join(' | ')}`)
    }
}
console.log(differences ? `${differences} entr(y|ies) of apis.mjs differ from the documentation` : 'The entries of apis.mjs found in the documentation have its versions')

if (args.candidates) {
    const mentioned = APIS.map(entry => `${entry.api} ${entry.pattern.source}`).join(' ')
    const candidates = documented
        .filter(doc => TARGETS.some(target => !available(doc.added, target)))
        .filter(doc => /^[\w$.]+$/.test(doc.name) && !mentioned.includes(last(doc.name)))
        //Never in the code of the packages: the errors, Node-API, the test runner, the modules of apis.mjs (node:sqlite)
        .filter(doc => !/^(ERR_|HPE_|napi_|node_api_)/.test(doc.name) && !/Test runner|TestContext|Mock\w+|error codes|SQLite|DatabaseSync|StatementSync/.test(doc.title))
    console.log(`\n${candidates.length} API(s) of the documentation the targets lack, mentioned by no entry:`)
    for (const doc of candidates) console.log(`  ${doc.name.padEnd(48)} ${doc.added.join(', ').padEnd(28)} ${doc.title}`)
}
