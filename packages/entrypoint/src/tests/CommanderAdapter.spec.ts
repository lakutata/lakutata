import {describe, it} from 'node:test'
import assert from 'node:assert'
import {PassThrough, Readable} from 'node:stream'
import {Container, DTO, Exception} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {BuildEntrypoints, Controller, Entrypoint, Result} from '../exports/Entrypoint.js'
import {CLIAction, Prefix} from '../exports/CTRLDecorators.js'
import {CommanderCLIEntrypoint, CommanderCLIEntrypointOptions} from '../exports/CommanderAdapter.js'

class DeviceDTO extends DTO {
    @Expect(DTO.String().required().description('The serial number'))
    public sn: string

    @Expect(DTO.Number().integer().min(1).default(3))
    public retries: number

    @Expect(DTO.Boolean().default(true))
    public verify: boolean

    @Expect(DTO.Boolean().optional())
    public force?: boolean

    @Expect(DTO.String().valid('fast', 'safe').optional())
    public mode?: string

    @Expect(DTO.Array(DTO.Number()).optional())
    public ports?: number[]

    @Expect(DTO.Object({site: DTO.String()}).optional())
    public labels?: Record<string, string>

    @Expect(DTO.String().optional())
    public deviceName?: string
}

class LoginDTO extends DTO {
    @Expect(DTO.String().required())
    public user: string

    @Expect(DTO.String().min(4).required())
    public password: string

    @Expect(DTO.String().valid('admin', 'guest').required())
    public role: string
}

class SumDTO extends DTO {
    @Expect(DTO.String().required().description('The label of the sum'))
    public label: string

    @Expect(DTO.Array(DTO.Number()).required())
    public numbers: number[]

    @Expect(DTO.String().optional().default('plain'))
    public format: string

    @Expect(DTO.Boolean().optional().default(false))
    public round: boolean
}

class FailedException extends Exception {
    public errno: string = 'E_FAILED'
}

@Prefix({command: 'device'})
class DeviceController extends Controller {
    @CLIAction('add', DeviceDTO)
    public async add(input: DeviceDTO): Promise<DeviceDTO> {
        return input
    }

    @CLIAction('fail')
    public async fail(): Promise<void> {
        throw new FailedException('The device is offline')
    }
}

class ToolController extends Controller {
    @CLIAction('hello')
    public async hello(): Promise<string> {
        return 'hello'
    }

    @CLIAction('quiet')
    public async quiet(): Promise<void> {
    }

    @CLIAction('status')
    public async status(): Promise<unknown> {
        return Result.status(201, {created: true})
    }

    @CLIAction('file')
    public async file(): Promise<unknown> {
        return Result.file(Readable.from(['a', 'b']))
    }

    @CLIAction('watch')
    public async watch(): Promise<unknown> {
        return Result.events(async (send): Promise<void> => {
            send({n: 1})
            send('done')
        })
    }

    @CLIAction('sum <label> <numbers...>', SumDTO)
    public async sum(input: SumDTO): Promise<string> {
        const total: number = input.numbers.reduce((sum: number, value: number): number => sum + value, 0)
        return `${input.label}=${input.round ? Math.round(total) : total} (${input.format})`
    }

    @CLIAction('login', LoginDTO)
    public async login(input: LoginDTO): Promise<LoginDTO> {
        return input
    }
}

type Run = { code: number | undefined, stdout: string, stderr: string }

/**
 * A stream collecting what is written to it
 */
function Collector(): PassThrough & { text: () => string } {
    const stream: PassThrough = new PassThrough()
    const chunks: Buffer[] = []
    stream.on('data', (chunk: Buffer): unknown => chunks.push(chunk))
    return Object.assign(stream, {text: (): string => Buffer.concat(chunks).toString()})
}

/**
 * Run the CLI with the arguments
 * @param argv
 * @param options
 * @param wait ms, how long the exit is waited for
 */
async function Run(argv: string[], options: CommanderCLIEntrypointOptions = {}, wait: number = 3000): Promise<Run> {
    const stdout = Collector()
    const stderr = Collector()
    let exited: (code: number) => void
    const code: Promise<number> = new Promise((resolve: (code: number) => void): void => {
        exited = resolve
    })
    const container: Container = new Container()
    await container.set(Entrypoint, BuildEntrypoints({
        controllers: [DeviceController, ToolController],
        cli: CommanderCLIEntrypoint({bin: 'tool', version: '1.2.3', interactive: false, ...options, argv: argv, stdout: stdout, stderr: stderr, exit: (value: number): void => exited(value)})
    }))
    const result: number | undefined = await Promise.race([code, new Promise<undefined>((resolve: (value?: undefined) => void): unknown => setTimeout(resolve, wait))])
    await container.destroy()
    return {code: result, stdout: stdout.text(), stderr: stderr.text()}
}

describe('Commander adapter', (): void => {

    it('runs the commands with the options of their input', async (): Promise<void> => {
        const run: Run = await Run(['device:add', '--sn', 'A1', '--retries', '5', '--no-verify', '--force', '--mode', 'safe', '--ports', '80', '443', '--labels', '{"site":"north"}', '--device-name', 'Pump'])
        assert.strictEqual(run.code, 0, run.stderr)
        assert.deepStrictEqual(JSON.parse(run.stdout), {sn: 'A1', retries: 5, verify: false, force: true, mode: 'safe', ports: [80, 443], labels: {site: 'north'}, deviceName: 'Pump'})
        //The defaults come from the DTO
        assert.deepStrictEqual(JSON.parse((await Run(['device:add', '--sn', 'A2'])).stdout), {sn: 'A2', retries: 3, verify: true})
    })

    it('writes the results', async (): Promise<void> => {
        assert.deepStrictEqual(await Run(['hello']), {code: 0, stdout: 'hello\n', stderr: ''})
        assert.deepStrictEqual(await Run(['quiet']), {code: 0, stdout: '', stderr: ''})
        assert.deepStrictEqual(JSON.parse((await Run(['status'])).stdout), {created: true})
        assert.strictEqual((await Run(['file'])).stdout, 'ab')
        assert.strictEqual((await Run(['watch'])).stdout, '{\n  "n": 1\n}\ndone\n')
        assert.strictEqual((await Run(['hello'], {format: (result: unknown): string => `<${result}>`})).stdout, '<hello>')
    })

    it('fails with the errors of the arguments and of the actions', async (): Promise<void> => {
        const missing: Run = await Run(['device:add'])
        assert.strictEqual(missing.code, 1)
        assert.match(missing.stderr, /required option '--sn <value>' not specified/)
        const invalid: Run = await Run(['device:add', '--sn', 'A1', '--retries', 'many'])
        assert.strictEqual(invalid.code, 1)
        assert.match(invalid.stderr, /Not a number/)
        const choice: Run = await Run(['device:add', '--sn', 'A1', '--mode', 'slow'])
        assert.match(choice.stderr, /Allowed choices are "fast", "safe"/)
        //Validated by the DTO
        const validated: Run = await Run(['device:add', '--sn', 'A1', '--retries', '0'])
        assert.strictEqual(validated.code, 1)
        assert.match(validated.stderr, /^error: .*retries/)
        assert.deepStrictEqual(await Run(['device:fail']), {code: 1, stdout: '', stderr: 'error: The device is offline\n'})
        const unknown: Run = await Run(['device:ad'])
        assert.strictEqual(unknown.code, 1)
        assert.match(unknown.stderr, /unknown command 'device:ad'.*\n.*device:add/)
        assert.strictEqual((await Run(['hello', 'extra'])).code, 1)
    })

    it('gives the positional arguments to the properties of their names', async (): Promise<void> => {
        assert.deepStrictEqual(await Run(['sum', 'total', '1.5', '2', '3']), {code: 0, stdout: 'total=6.5 (plain)\n', stderr: ''})
        assert.strictEqual((await Run(['sum', 'total', '1.5', '2', '--round', '--format', 'fancy'])).stdout, 'total=4 (fancy)\n')
        const invalid: Run = await Run(['sum', 'total', 'x'])
        assert.strictEqual(invalid.code, 1)
        assert.match(invalid.stderr, /Not a number/)
        const missing: Run = await Run(['sum', 'total'])
        assert.strictEqual(missing.code, 1)
        assert.match(missing.stderr, /missing required argument 'numbers'/)
        //The arguments are described with their properties, they are not options
        const help: Run = await Run(['sum', '--help'])
        assert.match(help.stdout, /Usage: tool sum \[options\] <label> <numbers\.\.\.>/)
        assert.match(help.stdout, /label\s+The label of the sum/)
        assert.doesNotMatch(help.stdout, /--label|--numbers/)
    })

    it('writes the help and the version', async (): Promise<void> => {
        const help: Run = await Run(['--help'])
        assert.strictEqual(help.code, 0)
        assert.match(help.stdout, /Usage: tool/)
        assert.match(help.stdout, /device:add/)
        const commandHelp: Run = await Run(['device:add', '--help'])
        assert.match(commandHelp.stdout, /--sn <value>\s+The serial number/)
        assert.match(commandHelp.stdout, /--retries <value>\s+\(default: 3\)/)
        assert.match(commandHelp.stdout, /--no-verify/)
        assert.match(commandHelp.stdout, /--mode <value>\s+\(choices: "fast", "safe"\)/)
        assert.deepStrictEqual(await Run(['--version']), {code: 0, stdout: '1.2.3\n', stderr: ''})
        const none: Run = await Run([])
        assert.strictEqual(none.code, 1)
        assert.match(none.stderr, /Usage: tool/)
        //The application keeps running
        assert.strictEqual((await Run([], {noCommand: 'ignore'}, 200)).code, undefined)
    })

    it('prompts for the missing required options', async (): Promise<void> => {
        const stdin: PassThrough = new PassThrough()
        const stdout = Collector()
        //Each answer is typed once its prompt is shown
        const typing: Promise<void> = (async (): Promise<void> => {
            for (const answer of ['admin\r', 'abc\r', 'd\r', '\u001b[B\r']) {
                await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 100))
                stdin.write(answer)
            }
        })()
        let exited: (code: number) => void
        const code: Promise<number> = new Promise((resolve: (code: number) => void): void => {
            exited = resolve
        })
        const container: Container = new Container()
        await container.set(Entrypoint, BuildEntrypoints({
            controllers: [ToolController],
            cli: CommanderCLIEntrypoint({argv: ['login'], interactive: true, stdin: stdin, stdout: stdout, stderr: process.stderr, exit: (value: number): void => exited(value)})
        }))
        await typing
        const result: number | undefined = await Promise.race([code, new Promise<undefined>((resolve: (value?: undefined) => void): unknown => setTimeout(resolve, 1000))])
        await container.destroy()
        const output: string = stdout.text()
        assert.strictEqual(result, 0)
        //The password too short is rejected by the DTO, then typed again without echo
        assert.match(output, /password.*length must be at least 4/)
        assert.ok(!output.slice(0, output.indexOf('{')).includes('abc'))
        assert.match(output, /\{\s+"user": "admin",\s+"password": "abcd",\s+"role": "guest"\s+\}/)
    })
})
