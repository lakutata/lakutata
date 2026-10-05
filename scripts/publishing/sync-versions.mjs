// The dependencies of the packages of the workspace on each other at the version of the workspace (lerna.json), exact:
// lerna version updates the dependencies, not the peer dependencies. The version lifecycle of the root runs it, once the
// packages are given their new version and before their manifests are committed.
//
// Run: node scripts/publishing/sync-versions.mjs

import {readdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const version = JSON.parse(readFileSync(path.join(ROOT, 'lerna.json'), 'utf8')).version
const manifests = readdirSync(path.join(ROOT, 'packages'))
    .map((name) => path.join(ROOT, 'packages', name, 'package.json'))
    .filter((file) => existsSync(file))
const names = new Set(manifests.map((file) => JSON.parse(readFileSync(file, 'utf8')).name))
let updated = 0
for (const file of manifests) {
    const text = readFileSync(file, 'utf8')
    const manifest = JSON.parse(text)
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const name of Object.keys(manifest[field] ?? {})) if (names.has(name)) manifest[field][name] = version
    }
    const next = `${JSON.stringify(manifest, null, 2)}\n`
    if (next !== text) {
        writeFileSync(file, next)
        updated++
    }
}
console.log(`The dependencies of the packages on each other at ${version}: ${updated} manifests updated`)
