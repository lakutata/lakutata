// The fixtures of the comparison with MongoDB 8.0 (src/tests/fixtures/mongodb-8.0.json): the scenarios of
// src/tests/compat/Scenarios.ts (built: npm run build:esm) run on a server, a replica set of one member, through the
// client of MongoDB of the repository, their outcomes normalized. Without --write, the outcomes are compared with the
// fixtures instead and the differences told.
//
//   LAKUTATA_MONGO_URL='mongodb://localhost:27917/?directConnection=true' node scripts/compat.mjs [--write]
import {readFileSync, writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {isDeepStrictEqual} from 'node:util'
import {normalized, SCENARIOS} from '../dist/esm/tests/compat/Scenarios.js'

const url = process.env.LAKUTATA_MONGO_URL
if (!url) throw new Error('LAKUTATA_MONGO_URL is not set: the URL of a server of MongoDB 8.0, a replica set of one member')
const {MongoClient} = createRequire(new URL('../../../package.json', import.meta.url))('mongodb')
const fixtures = new URL('../src/tests/fixtures/mongodb-8.0.json', import.meta.url)
// No retryable writes: the embedded MongoDB has none (a time series findOneAndDelete differs by them)
const client = new MongoClient(url, {retryWrites: false})
await client.connect()
const version = (await client.db('admin').command({buildInfo: 1})).version
const outcomes = {}
for (const scenario of SCENARIOS) {
    const db = client.db('compat')
    await db.dropDatabase()
    outcomes[scenario.name] = normalized(await scenario.run({client: client, db: db}))
    process.stdout.write('.')
}
await client.db('compat').dropDatabase()
await client.close()
process.stdout.write('\n')
if (process.argv.includes('--write')) {
    writeFileSync(fixtures, JSON.stringify({version: version, outcomes: outcomes}, null, 1) + '\n')
    console.log(`${Object.keys(outcomes).length} scenarios of MongoDB ${version} written`)
} else {
    const written = JSON.parse(readFileSync(fixtures, 'utf8'))
    for (const [name, outcome] of Object.entries(outcomes))
        if (!isDeepStrictEqual(outcome, written.outcomes[name])) console.log(`differs: ${name}`)
}
