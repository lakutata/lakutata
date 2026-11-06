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
const DONE: Set<string> = new Set<string>(['transactions', 'writeConcern'])

/**
 * The steps of the scenarios of a group done that still wait for a step not done: left out of the comparison
 */
const WAITING: Record<string, string[]> = {
    //watch in a transaction: the change streams (step 4)
    'the operations a transaction does not allow fail it': ['watch']
}

describe(`The embedded MongoDB compared with MongoDB ${FIXTURES.version}`, (): void => {
    for (const scenario of SCENARIOS) {
        if (!DONE.has(scenario.group)) {
            it.todo(`${scenario.group}: ${scenario.name}`)
            continue
        }
        it(`${scenario.group}: ${scenario.name}`, async (): Promise<void> => {
            const client: EmbeddedClient = await EmbeddedClient.connect()
            try {
                const outcome: Record<string, unknown> = normalized(await (scenario as Scenario).run({client: client, db: client.db('compat')})) as Record<string, unknown>
                const expected: Record<string, unknown> = {...FIXTURES.outcomes[scenario.name] as Record<string, unknown>}
                for (const step of WAITING[scenario.name] ?? []) {
                    delete outcome[step]
                    delete expected[step]
                }
                assert.deepStrictEqual(outcome, expected)
            } finally {
                await client.close()
            }
        })
    }
})
