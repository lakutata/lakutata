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

// typeorm (the Database component of @lakutata/orm) — named imports from deep subpaths
const {DataSource} = await import('typeorm/data-source/DataSource.js')
await check('typeorm DataSource construct', () => { new DataSource({type: 'sqlite', database: ':memory:'}) })
await check('CJS @lakutata/orm loads typeorm', () => {
    if (typeof requireCJS('../packages/orm/dist/cjs/exports/DatabaseComponent.js').Database !== 'function') throw new Error('Database missing')
    if (typeof requireCJS('../packages/orm/dist/cjs/exports/ORM.js').DataSource !== 'function') throw new Error('DataSource missing')
})
const ormPackage = await import('../packages/orm/dist/esm/exports/ORM.js')
await check('@lakutata/orm loads typeorm under ESM', () => {
    if (typeof ormPackage.DataSource !== 'function' || typeof ormPackage.BaseEntity !== 'function') throw new Error('ORM exports missing')
})

// Cacher store drivers (optional CJS peers) — loaded by the Cacher driver loader
const {LoadDriver} = await import('../packages/cache/dist/esm/cache/lib/LoadDriver.js')
for (const [member, packages] of [['createClient', ['redis', '@redis/client']], ['Client', ['memjs']], ['MongoClient', ['mongodb']], ['createPool', ['mysql2']], ['Pool', ['pg']], ['Database', ['sqlite3']]]) {
    await check(`${packages[0]} driver loads`, async () => { if (typeof (await LoadDriver(member, ...packages))[member] !== 'function') throw new Error(`${member} not callable`) })
}

// nats (the NATS component of @lakutata/nats) — named imports of the CJS nats client
const natsPackage = await import('../packages/nats/dist/esm/exports/Nats.js')
await check('@lakutata/nats loads the nats client', () => {
    if (typeof natsPackage.NATS !== 'function' || typeof natsPackage.NatsServiceEntrypoint !== 'function') throw new Error('NATS exports missing')
    if (typeof natsPackage.StringCodec !== 'function') throw new Error('nats StringCodec missing')
})

// commander (CLI adapter, ESM only) — required by the CJS build of the adapter
await check('CJS commander adapter loads', () => {
    if (typeof requireCJS('../packages/entrypoint/dist/cjs/exports/CommanderAdapter.js').CommanderCLIEntrypoint !== 'function') throw new Error('CommanderCLIEntrypoint missing')
})

// MCP SDK (the MCP channel) — required by the CJS build of @lakutata/mcp
await check('CJS @lakutata/mcp loads the MCP server', () => {
    const mcp = requireCJS('../packages/mcp/dist/cjs/exports/MCP.js')
    if (typeof mcp.HTTPMCPEntrypoint !== 'function' || typeof mcp.BuildMCPServer !== 'function') throw new Error('MCP exports missing')
})

// dbus-sdk (the DBus channel) — required by the CJS build of @lakutata/dbus
await check('CJS @lakutata/dbus loads dbus-sdk', () => {
    const dbus = requireCJS('../packages/dbus/dist/cjs/exports/DBus.js')
    if (typeof dbus.DBusEntrypoint !== 'function' || typeof dbus.LocalService !== 'function') throw new Error('DBus exports missing')
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

if (failures.length) {
    console.error('\nCJS-INTEROP FAILURES (' + failures.length + '):\n' + failures.join('\n'))
    process.exit(1)
}
console.log('\nAll orm/docker/cache CJS deps import + run under pure ESM.')
