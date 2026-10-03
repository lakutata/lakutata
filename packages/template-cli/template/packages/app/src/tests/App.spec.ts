import {describe, it} from 'node:test'
//@if i18n
import {before} from 'node:test'
//@end
import assert from 'node:assert'
import {execFile, type ExecFileException} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

/**
 * The compiled tool
 */
const TOOL: string = fileURLToPath(new URL('../App.js', import.meta.url))

/**
 * Run the tool with arguments
 * @param args
 */
function Tool(...args: string[]): Promise<{ code: number, stdout: string, stderr: string }> {
    return new Promise((resolve: (result: { code: number, stdout: string, stderr: string }) => void): void => {
        execFile(process.execPath, [TOOL, ...args], (error: ExecFileException | null, stdout: string, stderr: string): void => resolve({code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: stdout, stderr: stderr}))
    })
}

describe('{$APP_NAME}', (): void => {
    //@if i18n

    //The tool answers in the language of its environment: English for the tests
    before((): void => {
        process.env.LC_ALL = 'en_US.UTF-8'
    })
    //@end

    it('greets', async (): Promise<void> => {
        const result = await Tool('greet', '--name', 'you')
        assert.strictEqual(result.code, 0, result.stderr)
        assert.strictEqual(result.stdout.trim(), 'Hello, you!')
    })

    //@if i18n
    it('greets in the language of its environment', async (): Promise<void> => {
        process.env.LC_ALL = 'zh_CN.UTF-8'
        try {
            assert.strictEqual((await Tool('greet', '--name', 'you')).stdout.trim(), '你好，you！')
        } finally {
            process.env.LC_ALL = 'en_US.UTF-8'
        }
    })

    //@end
    it('greets with the options', async (): Promise<void> => {
        const result = await Tool('greet', '--name', 'you', '--times', '2', '--loud')
        assert.strictEqual(result.stdout.trim(), 'HELLO, YOU!\nHELLO, YOU!')
    })

    it('refuses an invalid option', async (): Promise<void> => {
        const result = await Tool('greet', '--name', 'you', '--times', '11')
        assert.notStrictEqual(result.code, 0)
        assert.match(result.stderr, /times/)
    })

    it('shows its version', async (): Promise<void> => {
        const {version} = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
        assert.strictEqual((await Tool('--version')).stdout.trim(), version)
    })
})
