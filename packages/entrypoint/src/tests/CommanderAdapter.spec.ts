import {describe, it} from 'node:test'
import assert from 'node:assert'
import {PassThrough, Readable} from 'node:stream'
import {Container, DTO, Exception} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {BuildEntrypoints, Controller, Entrypoint, Result} from '../exports/Entrypoint.js'
import {CLIAction, Prefix} from '../exports/CTRLDecorators.js'
import {CommanderCLIEntrypoint, CommanderCLIEntrypointOptions, type CLIText} from '../exports/CommanderAdapter.js'

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

    //A flag or a value: --link, --link wifi
    @Expect(DTO.Alternatives(DTO.Boolean(), DTO.String().valid('wifi', 'cable')).optional())
    public link?: boolean | 'wifi' | 'cable'
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

class GreetDTO extends DTO {
    @Expect(DTO.String().required().description('Who is greeted'))
    public name: string

    @Expect(DTO.String().required().description('The title'))
    public title: string

    @Expect(DTO.Number().integer().optional().default(1).description('How many times'))
    public times: number

    @Expect(DTO.Boolean().optional().default(true).description('Greet politely'))
    public polite: boolean

    @Expect(DTO.String().valid('en', 'zh').optional().description('The language'))
    public language?: string
}

class GreetController extends Controller {
    @CLIAction('greet <name>', GreetDTO, {description: 'Greet someone'})
    public async greet(input: GreetDTO): Promise<string> {
        return `${input.title} ${input.name}`
    }
}

/**
 * The Chinese texts of the help and of the prompts, by their keys
 */
const CHINESE: Record<string, string> = {
    'description': '示例工具',
    'commands.greet.description': '问候某人',
    'commands.greet.arguments.name': '被问候的人',
    'commands.greet.options.title': '称呼',
    'commands.greet.options.times': '次数',
    'commands.greet.options.polite': '礼貌地问候',
    'commands.greet.options.language': '语言：问候所用的语言，可以是英文或中文，默认按照环境变量中的语言来确定，没有设置时使用英文',
    'help.usage': '用法：',
    'help.arguments': '参数：',
    'help.options': '选项：',
    'help.commands': '命令：',
    'help.helpOption': '显示命令的帮助',
    'help.helpCommand': '显示命令的帮助',
    'help.versionOption': '显示版本号',
    'help.default': '默认：{value}',
    'help.choices': '可选：{choices}',
    'help.negate': '关闭 {flag}',
    'help.hints': '（{hints}）',
    'help.separator': '，'
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

    it('gives the flags of a boolean or a value an optional value', async (): Promise<void> => {
        assert.strictEqual(JSON.parse((await Run(['device:add', '--sn', 'A3'])).stdout).link, undefined)
        assert.strictEqual(JSON.parse((await Run(['device:add', '--sn', 'A3', '--link'])).stdout).link, true)
        assert.strictEqual(JSON.parse((await Run(['device:add', '--link', 'cable', '--sn', 'A3'])).stdout).link, 'cable')
        const invalid: Run = await Run(['device:add', '--sn', 'A3', '--link', 'radio'])
        assert.notStrictEqual(invalid.code, 0)
        assert.match(invalid.stderr, /Allowed choices are "wifi", "cable"/)
        const help: Run = await Run(['device:add', '--help'])
        assert.match(help.stdout, /--link \[value\][\s\S]*choices: "wifi", "cable"/)
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

    it('gives the help in the language of the user, the names of the commands and options kept', async (): Promise<void> => {
        const asked: string[] = []
        const translate = (): (text: CLIText) => string => (text: CLIText): string => {
            asked.push(text.key)
            return (CHINESE[text.key] ?? text.text).replace(/\{(\w+)\}/g, (all: string, name: string): string => text.params?.[name] ?? all)
        }
        const run = async (argv: string[]): Promise<string> => {
            const stdout = Collector()
            const container: Container = new Container()
            await container.set(Entrypoint, BuildEntrypoints({
                controllers: [GreetController],
                cli: CommanderCLIEntrypoint({bin: 'tool', version: '1.2.3', description: 'A sample tool', interactive: false, translate: translate, argv: argv, stdout: stdout, stderr: stdout, exit: (): undefined => undefined})
            }))
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 300))
            await container.destroy()
            return stdout.text()
        }
        const program: string = await run(['--help'])
        for (const pattern of [/用法： tool \[options\] \[command\]/, /示例工具/, /选项：/, /-V, --version\s+显示版本号/, /-h, --help\s+显示命令的帮助/, /命令：/, /greet \[options\] <name>\s+问候某人/, /help \[command\]\s+显示命令的帮助/]) assert.match(program, pattern)
        const command: string = await run(['greet', '--help'])
        for (const text of ['用法： tool greet [options] <name>', '问候某人', '参数：', 'name ', '被问候的人', '--title <value>', '称呼', '--times <value>', '次数（默认：1）', '--polite', '礼貌地问候（默认：true）', '--no-polite', '关闭 --polite', '--language <value>', '没有设置时使用英文（可选："en", "zh"）']) assert.ok(command.includes(text), `${text}\n${command}`)
        assert.doesNotMatch(command, /Usage|Options|default:|display help/)
        //The wide characters take two columns: the lines are wrapped to the width of the help (80 columns)
        assert.ok(command.split('\n').every((line: string): boolean => [...line].reduce((width: number, character: string): number => width + (/[\u3000-\u9fff\uff00-\uffef]/.test(character) ? 2 : 1), 0) <= 80), command)
        assert.ok(['description', 'commands.greet.description', 'commands.greet.arguments.name', 'commands.greet.options.title', 'help.negate'].every((key: string): boolean => asked.includes(key)), asked.join(', '))
        //Without the translation: the English texts
        const english: string = await (async (): Promise<string> => {
            const stdout = Collector()
            const container: Container = new Container()
            await container.set(Entrypoint, BuildEntrypoints({controllers: [GreetController], cli: CommanderCLIEntrypoint({bin: 'tool', interactive: false, argv: ['greet', '--help'], stdout: stdout, stderr: stdout, exit: (): undefined => undefined})}))
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 300))
            await container.destroy()
            return stdout.text()
        })()
        for (const text of ['Usage: tool greet [options] <name>', 'Greet someone', 'Who is greeted', 'How many times (default: 1)', 'Turn off --polite', 'display help for command']) assert.ok(english.includes(text), `${text}\n${english}`)
    })

    it('prompts in the language of the user', async (): Promise<void> => {
        const stdin: PassThrough = new PassThrough()
        const stdout = Collector()
        const typing: Promise<void> = (async (): Promise<void> => {
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 200))
            stdin.write('Dr.\r')
        })()
        let exited: (code: number) => void
        const code: Promise<number> = new Promise((resolve: (code: number) => void): void => {
            exited = resolve
        })
        const container: Container = new Container()
        await container.set(Entrypoint, BuildEntrypoints({
            controllers: [GreetController],
            cli: CommanderCLIEntrypoint({argv: ['greet', 'Ada'], interactive: true, translate: () => (text: CLIText): string => CHINESE[text.key] ?? text.text, stdin: stdin, stdout: stdout, stderr: process.stderr, exit: (value: number): void => exited(value)})
        }))
        await typing
        const result: number | undefined = await Promise.race([code, new Promise<undefined>((resolve: (value?: undefined) => void): unknown => setTimeout(resolve, 1000))])
        await container.destroy()
        assert.strictEqual(result, 0)
        assert.match(stdout.text(), /称呼 \(title\)/)
        assert.match(stdout.text(), /Dr\. Ada/)
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
