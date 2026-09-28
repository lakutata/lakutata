// CJS-interop runtime smoke: verifies the third-party CJS deps used by the
// orm/docker/cacher components import AND run (construct/call) under pure ESM,
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

// typeorm (Database component) — named imports from deep subpaths
const {DataSource} = await import('typeorm/data-source/DataSource.js')
await check('typeorm DataSource construct', () => { new DataSource({type: 'sqlite', database: ':memory:'}) })

// Cacher store drivers (optional CJS peers) — loaded by the Cacher driver loader
const {LoadDriver} = await import('../packages/cacher/dist/esm/cacher/lib/LoadDriver.js')
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
const {createRequire} = await import('node:module')
const requireCJS = createRequire(import.meta.url)
await check('CJS commander adapter loads', () => {
    if (typeof requireCJS('../packages/entrypoint/dist/cjs/exports/CommanderAdapter.js').CommanderCLIEntrypoint !== 'function') throw new Error('CommanderCLIEntrypoint missing')
})

// MCP SDK (the MCP channel) — required by the CJS build of @lakutata/mcp
await check('CJS @lakutata/mcp loads the MCP server', () => {
    const mcp = requireCJS('../packages/mcp/dist/cjs/exports/MCP.js')
    if (typeof mcp.HTTPMCPEntrypoint !== 'function' || typeof mcp.BuildMCPServer !== 'function') throw new Error('MCP exports missing')
})

// dockerode (Docker component) — default import; construct does not connect
const Dockerode = (await import('dockerode')).default
await check('dockerode construct (no connect)', () => { new Dockerode({socketPath: '/nonexistent/docker.sock'}) })

// patrun (Entrypoint dispatch) — named import
const {Patrun} = await import('patrun')
await check('patrun construct', () => { new Patrun() })

if (failures.length) {
    console.error('\nCJS-INTEROP FAILURES (' + failures.length + '):\n' + failures.join('\n'))
    process.exit(1)
}
console.log('\nAll orm/docker/cacher CJS deps import + run under pure ESM.')
