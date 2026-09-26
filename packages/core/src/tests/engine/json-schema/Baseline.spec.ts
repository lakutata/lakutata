/**
 * Ported from the upstream test/baseline.spec.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md)
 * Checks that the engine describes the fixture schemas like the engine release the baseline was made with.
 * Upstream test logic is kept (only the runner, the module loading and the code style differ). Not type-checked.
 */
// @ts-nocheck
import {readdirSync} from 'node:fs'
import {it} from 'node:test'
import engine from '../../../lib/validation/engine/schema/index.js'
import {readJson, toEqual} from './support.js'

const fixturesDir = new URL('./fixtures/', import.meta.url)
const fixtures = readdirSync(fixturesDir).filter((fileName) => /\.js$/.test(fileName))

for (const fixtureFileName of fixtures) {
    const {default: fixtureFn} = await import(new URL(fixtureFileName, fixturesDir).href)
    const fixture = fixtureFn(engine)

    Object.keys(fixture).forEach((conversionCase) => {
        if (process.env.TEST_CASE && !process.env.TEST_CASE.split(',').includes(conversionCase)) {
            return
        }

        it(`Baseline Schema: ${fixtureFileName} - ${conversionCase}`, () => {
            const result = fixture[conversionCase].describe()

            const output = readJson(`outputs-baseline/${fixtureFileName.replace(/\.js/, '')}/${conversionCase}.json`)
            toEqual(result, output)
        })
    })
}
