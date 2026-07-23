// G2 runtime API snapshot (consumer-facing surface baseline).
// Captures sorted Object.keys(await import(subpath)) for every code subpath
// from the BUILT distro. Commit the resulting api-snapshot.runtime.json as the
// pre-build-swap baseline. Re-run after the tsc-dual swap (and any package
// extraction): exit 0 = surface identical, exit 1 = drift (a public export was
// added/removed/renamed). Pairs with test:types (which checks .d.ts resolution).
import {writeFileSync, readFileSync, existsSync} from 'node:fs'

const subpaths = [
    'lakutata',
    'lakutata/orm',
    'lakutata/dtos',
    'lakutata/helper',
    'lakutata/com/docker',
    'lakutata/com/database',
    'lakutata/com/cacher',
    'lakutata/com/monitor',
    'lakutata/com/entrypoint',
    'lakutata/com/logger',
    'lakutata/provider/database',
    'lakutata/provider/passwordHash',
    'lakutata/decorator/asst',
    'lakutata/decorator/ctrl',
    'lakutata/decorator/di',
    'lakutata/decorator/dto',
    'lakutata/decorator/orm'
]

const snapshotFile = new URL('./api-snapshot.runtime.json', import.meta.url)
//Import the BUILT distro .mjs directly (the committed package.json exports point
//at src/*.ts for dev tooling, so the bare 'lakutata' specifier resolves to
//unrunnable source; the distro .mjs is the real published runtime surface).
const distroEntry = sp => sp === 'lakutata' ? 'lakutata' : sp.replace(/^lakutata\//, '')
const current = {}
for (const sp of subpaths) {
    const mod = await import(`../packages/lakutata/distro/${distroEntry(sp)}.mjs`)
    current[sp] = Object.keys(mod).sort()
}
const currentJson = JSON.stringify(current, null, 2) + '\n'

if (existsSync(snapshotFile)) {
    const baseline = JSON.parse(readFileSync(snapshotFile, 'utf8'))
    const drift = []
    for (const sp of subpaths) {
        const before = new Set(baseline[sp] || [])
        const after = new Set(current[sp])
        const removed = [...before].filter(k => !after.has(k))
        const added = [...after].filter(k => !before.has(k))
        if (removed.length || added.length) drift.push({sp, removed, added})
    }
    if (drift.length) {
        console.error('PUBLIC API SURFACE DRIFT detected:')
        for (const d of drift) console.error(`  ${d.sp}: removed=${d.removed.join(',') || '(none)'} added=${d.added.join(',') || '(none)'}`)
        process.exit(1)
    }
    console.log(`API surface identical across ${subpaths.length} subpaths.`)
} else {
    writeFileSync(snapshotFile, currentJson)
    console.log(`Baseline written: ${subpaths.length} subpaths -> api-snapshot.runtime.json`)
}
