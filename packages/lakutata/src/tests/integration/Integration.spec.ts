import {describe, it} from 'node:test'
import assert from 'node:assert'
import {execFile, type ExecFileException} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {CHECK_PREFIX, type CheckResult} from './support/Scenario.js'

/**
 * The scenarios: applications composing the packages through the public paths of lakutata (its barrels), one per
 * process, each one running its checks once launched. The scenarios needing a service are skipped without it
 */
const SCENARIOS: { file: string, title: string, skip?: string | false }[] = [
    {file: 'Service', title: 'a service of the 3.0 adapters (Express, Fastify, Socket.IO, Commander) and of the components (database, cache, logger, password hash)'},
    {file: 'Legacy', title: 'an application of the entrypoints of lakutata 2.x (BuildHTTPEntrypoint with Express, BuildServiceEntrypoint, BuildCLIEntrypoint)'},
    {file: 'Docker', title: 'the Docker component', skip: process.env.LAKUTATA_DOCKER ? false : 'LAKUTATA_DOCKER is not set (the Docker engine of the machine)'}
]

/**
 * Run a scenario
 * @param file
 */
function Run(file: string): Promise<{ code: number, checks: CheckResult[], output: string }> {
    return new Promise((resolve: (result: { code: number, checks: CheckResult[], output: string }) => void): void => {
        //The application of the scenario is not a test of the runner
        const {NODE_TEST_CONTEXT, ...env} = process.env
        void NODE_TEST_CONTEXT
        execFile(process.execPath, [fileURLToPath(new URL(`./scenarios/${file}.js`, import.meta.url))], {env: env, timeout: 120000, maxBuffer: 64 * 1024 * 1024}, (error: ExecFileException | null, stdout: string, stderr: string): void => {
            const checks: CheckResult[] = stdout.split('\n')
                .filter((line: string): boolean => line.startsWith(CHECK_PREFIX))
                .map((line: string): CheckResult => JSON.parse(line.slice(CHECK_PREFIX.length)))
            resolve({code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, checks: checks, output: `${stdout}${stderr}`})
        })
    })
}

describe('The integration of the packages', (): void => {
    for (const scenario of SCENARIOS) {
        it(scenario.title, {skip: scenario.skip}, async (t): Promise<void> => {
            const result = await Run(scenario.file)
            //Its checks ran: an application failing to launch runs none
            assert.ok(result.checks.length, `No check ran:\n${result.output}`)
            for (const check of result.checks) {
                await t.test(check.name, (): void => {
                    if (!check.ok) assert.fail(check.error)
                })
            }
            assert.strictEqual(result.code, 0, `The scenario exited with the code ${result.code}:\n${result.output}`)
        })
    }
})
