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
    'lakutata/utils',
    'lakutata/com/containerd',
    'lakutata/com/docker',
    'lakutata/com/database',
    'lakutata/com/cacher',
    'lakutata/com/mutex',
    'lakutata/com/monitor',
    'lakutata/com/i18n',
    'lakutata/com/entrypoint',
    'lakutata/adapter/express',
    'lakutata/adapter/commander',
    'lakutata/adapter/fastify',
    'lakutata/adapter/socket.io',
    'lakutata/adapter/jsonrpc',
    'lakutata/adapter/electron',
    'lakutata/com/logger',
    'lakutata/provider/database',
    'lakutata/provider/passwordHash',
    'lakutata/security',
    'lakutata/decorator/asst',
    'lakutata/decorator/ctrl',
    'lakutata/decorator/di',
    'lakutata/decorator/dto',
    'lakutata/decorator/orm'
]

const snapshotFile = new URL('./api-snapshot.runtime.json', import.meta.url)
//Import the BUILT dist/esm entry barrel directly (subpath -> barrel filename is
//not 1:1, so enumerate it; the bare 'lakutata' specifier resolves to source .ts
//which Node cannot run, and the old flat distro layout is gone under tsc-dual).
const entryMap = {
    'lakutata': 'Lakutata',
    'lakutata/orm': 'ORM',
    'lakutata/dtos': 'DTOs',
    'lakutata/utils': 'Utils',
    'lakutata/com/containerd': 'ContainerdComponent',
    'lakutata/com/docker': 'DockerComponent',
    'lakutata/com/database': 'DatabaseComponent',
    'lakutata/com/cacher': 'CacherComponent',
    'lakutata/com/mutex': 'MutexComponent',
    'lakutata/com/monitor': 'MonitorComponent',
    'lakutata/com/i18n': 'I18nComponent',
    'lakutata/com/entrypoint': 'EntrypointComponent',
    'lakutata/adapter/express': 'ExpressAdapter',
    'lakutata/adapter/commander': 'CommanderAdapter',
    'lakutata/adapter/fastify': 'FastifyAdapter',
    'lakutata/adapter/socket.io': 'SocketIOAdapter',
    'lakutata/adapter/jsonrpc': 'JSONRPCAdapter',
    'lakutata/adapter/electron': 'ElectronAdapter',
    'lakutata/com/logger': 'LoggerComponent',
    'lakutata/provider/database': 'DatabaseProvider',
    'lakutata/provider/passwordHash': 'PasswordHashProvider',
    'lakutata/security': 'Security',
    'lakutata/decorator/asst': 'ASSTDecorators',
    'lakutata/decorator/ctrl': 'CTRLDecorators',
    'lakutata/decorator/di': 'DIDecorators',
    'lakutata/decorator/dto': 'DTODecorators',
    'lakutata/decorator/orm': 'ORMDecorators'
}
const current = {}
for (const sp of subpaths) {
    const mod = await import(`../packages/lakutata/dist/esm/exports/${entryMap[sp]}.js`)
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
