// CJS-interop runtime smoke: verifies the third-party CJS deps used by the
// orm/docker/cache components import AND run (construct/call) under pure ESM,
// with no bundler. api-surface already proves these import cleanly (the barrels
// load the component modules); this additionally exercises runtime construction
// to catch any dep that imports fine but fails to call under Node ESM.
// Run: node consumer-fixture/cjs-interop-smoke.mjs

const failures = []
const check = async (name, fn) => {
    try {
        await fn()
        console.log('  ok  ' + name)
    } catch (e) {
        failures.push(name + ': ' + e.message.split('\n')[0])
        console.log(' FAIL  ' + name + '  -> ' + e.message.split('\n')[0])
    }
}

// The CJS builds of the packages are loaded by require
const {createRequire} = await import('node:module')
const requireCJS = createRequire(import.meta.url)

// TypeORM (the Database component of @lakutata/orm) — named imports from deep subpaths of its CommonJS build in the
// package (dist/vendor/typeorm, the #typeorm/* imports of the package)
const {DataSource} = await import('../packages/orm/dist/vendor/typeorm/data-source/DataSource.js')
await check('typeorm DataSource construct', () => { new DataSource({type: 'better-sqlite3', database: ':memory:'}) })
await check('CJS @lakutata/orm loads typeorm', () => {
    if (typeof requireCJS('../packages/orm/dist/cjs/exports/DatabaseComponent.js').Database !== 'function') throw new Error('Database missing')
    if (typeof requireCJS('../packages/orm/dist/cjs/exports/ORM.js').DataSource !== 'function') throw new Error('DataSource missing')
})
const ormPackage = await import('../packages/orm/dist/esm/exports/ORM.js')
await check('@lakutata/orm loads typeorm under ESM', () => {
    if (typeof ormPackage.DataSource !== 'function' || typeof ormPackage.BaseEntity !== 'function') throw new Error('ORM exports missing')
})

// Cacher store drivers (optional CJS peers) — loaded by the Cacher driver loader
const {loadDriver} = await import('../packages/cache/dist/esm/cache/lib/LoadDriver.js')
for (const [member, packages] of [['createClient', ['redis', '@redis/client']], ['Client', ['memjs']], ['MongoClient', ['mongodb']], ['createPool', ['mysql2']], ['Pool', ['pg']]]) {
    await check(`${packages[0]} driver loads`, async () => { if (typeof (await loadDriver(member, ...packages))[member] !== 'function') throw new Error(`${member} not callable`) })
}
// better-sqlite3: its module is its class Database
await check('better-sqlite3 driver loads', async () => { new (await loadDriver('default', 'better-sqlite3'))(':memory:').close() })

// nats (the NATS component of @lakutata/nats) — named imports of the CJS nats client
const natsPackage = await import('../packages/nats/dist/esm/exports/Nats.js')
await check('@lakutata/nats loads the nats client', () => {
    if (typeof natsPackage.NATS !== 'function' || typeof natsPackage.natsServiceEntrypoint !== 'function') throw new Error('NATS exports missing')
    if (typeof natsPackage.StringCodec !== 'function') throw new Error('nats StringCodec missing')
})

// commander (CLI adapter, ESM only) — required by the CJS build of the adapter
await check('CJS commander adapter loads', () => {
    if (typeof requireCJS('../packages/entrypoint/dist/cjs/exports/CommanderAdapter.js').commanderCLIEntrypoint !== 'function') throw new Error('commanderCLIEntrypoint missing')
})

// MCP SDK (the MCP channel) — required by the CJS build of @lakutata/mcp
await check('CJS @lakutata/mcp loads the MCP server', () => {
    const mcp = requireCJS('../packages/mcp/dist/cjs/exports/MCP.js')
    if (typeof mcp.httpMCPEntrypoint !== 'function' || typeof mcp.buildMCPServer !== 'function') throw new Error('MCP exports missing')
})

// dbus-sdk (the DBus channel) — required by the CJS build of @lakutata/dbus
await check('CJS @lakutata/dbus loads dbus-sdk', () => {
    const dbus = requireCJS('../packages/dbus/dist/cjs/exports/DBus.js')
    if (typeof dbus.dbusEntrypoint !== 'function' || typeof dbus.LocalService !== 'function') throw new Error('DBus exports missing')
})
// dbus-sdk named imports under ESM
const dbusPackage = await import('../packages/dbus/dist/esm/exports/DBus.js')
await check('@lakutata/dbus loads dbus-sdk under ESM', () => {
    if (typeof dbusPackage.DBusObjectManager !== 'function' || typeof dbusPackage.DBus !== 'function') throw new Error('DBus exports missing')
})

// @lakutata/docker — the client of the Docker Engine API is integrated; tar-stream (CJS) packs the build contexts
await check('CJS @lakutata/docker loads', () => {
    if (typeof requireCJS('../packages/docker/dist/cjs/exports/Docker.js').Docker !== 'function') throw new Error('Docker missing')
})
const dockerPackage = await import('../packages/docker/dist/esm/exports/Docker.js')
await check('@lakutata/docker loads under ESM', () => {
    if (typeof dockerPackage.Docker !== 'function') throw new Error('Docker missing')
})
const {pack: TarPack} = await import('tar-stream')
await check('tar-stream pack (build context)', () => { TarPack().finalize() })

// @lakutata/mutex — the locks (their clients of Redis, PostgreSQL and MySQL loaded when used)
await check('CJS @lakutata/mutex loads', () => {
    if (typeof requireCJS('../packages/mutex/dist/cjs/exports/Mutex.js').Mutex !== 'function') throw new Error('Mutex missing')
})

// @lakutata/queue — the message queues (their clients loaded when used)
await check('CJS @lakutata/queue loads', () => {
    const queue = requireCJS('../packages/queue/dist/cjs/exports/Queue.js')
    if (typeof queue.Queue !== 'function' || typeof queue.queueEntrypoint !== 'function') throw new Error('Queue missing')
})

// @lakutata/webrtc — the signaling, the TURN server and the peer connections; the browser entry without the framework
await check('CJS @lakutata/webrtc loads', () => {
    const webrtc = requireCJS('../packages/webrtc/dist/cjs/exports/WebRTC.js')
    if (typeof webrtc.Signaling !== 'function' || typeof webrtc.PeerConnection !== 'function' || typeof webrtc.TURNServer !== 'function') throw new Error('WebRTC missing')
    if (typeof requireCJS('../packages/webrtc/dist/cjs/exports/Client.js').SignalingConnection !== 'function') throw new Error('SignalingConnection missing')
})

// @lakutata/ffi — the native libraries, koffi required from CommonJS
await check('CJS @lakutata/ffi loads and calls the C library', () => {
    const ffi = requireCJS('../packages/ffi/dist/cjs/exports/FFI.js')
    if (typeof ffi.NativeLibrary !== 'function' || typeof ffi.loadNativeLibrary !== 'function' || typeof ffi.Native !== 'function') throw new Error('FFI missing')
    const libc = ffi.loadNativeLibrary('c')
    if (libc.func('int abs(int value)')(-3) !== 3) throw new Error('abs of the C library')
})

// @lakutata/math — its addon (built when the package is installed) required by a path from the CommonJS module
await check('CJS @lakutata/math loads its addon', () => {
    const math = requireCJS('../packages/math/dist/cjs/exports/Math.js')
    if (typeof math.createMath !== 'function' || typeof math.expression !== 'function' || typeof math.Expression !== 'function') throw new Error('createMath missing')
    if (math.expression('(x + 1)^2').expand().toString() !== 'x^2 + 2x + 1') throw new Error('the functions of math')
    if (typeof requireCJS('../packages/math/dist/cjs/lib/Addon.js').addon.versions().symengine !== 'string') throw new Error('the addon of math')
})
const mathPackage = await import('../packages/math/dist/esm/exports/Math.js')
await check('@lakutata/math loads under ESM', () => {
    if (typeof mathPackage.createMath !== 'function' || mathPackage.stats.mean([1, 2, 3]) !== 2) throw new Error('createMath missing')
})

// @lakutata/grpc — the gRPC over HTTP/2 of containerd, BuildKit and the service actions
await check('CJS @lakutata/grpc loads', () => {
    if (typeof requireCJS('../packages/grpc/dist/cjs/exports/GRPC.js').GRPCServer !== 'function') throw new Error('GRPCServer missing')
    if (typeof requireCJS('../packages/grpc/dist/cjs/exports/GRPCService.js').grpcServiceEntrypoint !== 'function') throw new Error('grpcServiceEntrypoint missing')
})

// @lakutata/containerd — the client of the API of containerd (gRPC over HTTP/2) is integrated
await check('CJS @lakutata/containerd loads', () => {
    if (typeof requireCJS('../packages/containerd/dist/cjs/exports/Containerd.js').Containerd !== 'function') throw new Error('Containerd missing')
})
const containerdPackage = await import('../packages/containerd/dist/esm/exports/Containerd.js')
await check('@lakutata/containerd loads under ESM', () => {
    if (typeof containerdPackage.Containerd !== 'function') throw new Error('Containerd missing')
})

// @lakutata/i18n: its CJS build formats with Intl
await check('CJS @lakutata/i18n parses and formats', () => {
    const {parseMessage, I18n} = requireCJS('../packages/i18n/dist/cjs/exports/I18n.js')
    if (typeof I18n !== 'function' || parseMessage('{n, plural, other {# items}}').length !== 1) throw new Error('I18n missing')
    if (typeof requireCJS('../packages/i18n/dist/cjs/exports/I18nMiddleware.js').I18nMiddleware !== 'function') throw new Error('I18nMiddleware missing')
})

// The SDKs bundled with lakutata 2.x require the framework through the interop of Rollup: the default of a module marked
// __esModule (the CJS entries of 3.0) is the entry itself (scripts/package-build/cjs-package.mjs)
const interopDefault = (e) => e && e.__esModule ? e : {default: e}
for (const [name, entry, member] of [['lakutata', 'lakutata/dist/cjs/exports/Lakutata.js', 'DTO'], ['lakutata/decorator/dto', 'lakutata/dist/cjs/exports/DTODecorators.js', 'Expect'], ['@lakutata/nats', 'nats/dist/cjs/exports/Nats.js', 'NATS'], ['@lakutata/utils/helper/*', 'utils/dist/cjs/lib/helpers/UniqueArray.js', 'uniqueArray']]) {
    await check(`CJS ${name} through the interop of the 2.x bundles`, () => {
        const required = requireCJS(`../packages/${entry}`)
        if (interopDefault(required).default !== required || typeof required.default[member] !== 'function') throw new Error(`${member} missing from the default`)
        if (Object.keys(required).includes('default')) throw new Error('the default is enumerated')
    })
}

if (failures.length) {
    console.error('\nCJS-INTEROP FAILURES (' + failures.length + '):\n' + failures.join('\n'))
    process.exit(1)
}
console.log('\nAll orm/docker/cache CJS deps import + run under pure ESM.')
