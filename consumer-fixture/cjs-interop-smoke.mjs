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

// cache-manager (Cacher component) — named import
const cacheManager = await import('cache-manager')
await check('cache-manager createCache callable', () => { if (typeof cacheManager.createCache !== 'function') throw new Error('createCache not a function') })

// keyv + keyv-file (Cacher file store) — default + named
const Keyv = (await import('keyv')).default
await check('keyv construct (in-memory)', () => { new Keyv() })
const {KeyvFile} = await import('keyv-file')
await check('keyv-file KeyvFile callable', () => { if (typeof KeyvFile !== 'function') throw new Error('KeyvFile not callable') })

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
