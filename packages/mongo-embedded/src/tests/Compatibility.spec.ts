import {describe, it} from 'node:test'
import assert from 'node:assert'
import {readFileSync} from 'node:fs'
import {EmbeddedClient} from '../exports/MongoEmbedded.js'
import {normalized, type Scenario, SCENARIOS} from './compat/Scenarios.js'

/**
 * The outcomes of the scenarios on MongoDB 8.0 (scripts/compat.mjs)
 */
const FIXTURES: { version: string, outcomes: Record<string, unknown> } = JSON.parse(readFileSync(new URL('../../../src/tests/fixtures/mongodb-8.0.json', import.meta.url), 'utf8'))

/**
 * The groups of the scenarios done (the steps of the phase): the others are still to do
 */
const DONE: Set<string> = new Set<string>([])

describe(`The embedded MongoDB compared with MongoDB ${FIXTURES.version}`, (): void => {
    for (const scenario of SCENARIOS) {
        if (!DONE.has(scenario.group)) {
            it.todo(`${scenario.group}: ${scenario.name}`)
            continue
        }
        it(`${scenario.group}: ${scenario.name}`, async (): Promise<void> => {
            const client: EmbeddedClient = await EmbeddedClient.connect()
            try {
                const outcome: unknown = normalized(await (scenario as Scenario).run({client: client, db: client.db('compat')}))
                assert.deepStrictEqual(outcome, FIXTURES.outcomes[scenario.name])
            } finally {
                await client.close()
            }
        })
    }
})
