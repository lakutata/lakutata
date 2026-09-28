import {Command, CommanderError, InvalidArgumentError, Option} from 'commander'
import {createReadStream} from 'node:fs'
import path from 'node:path'
import type {Readable} from 'node:stream'
import {Application} from '@lakutata/core'
import type {ChannelActionInfo, ChannelRuntime, EntrypointAdapter} from '../../channel/EntrypointAdapter.js'
import type {MiddlewareDefinition} from '../../lib/Middleware.js'
import {CLIContext} from '../../context/CLIContext.js'
import {CLIChannel} from '../../channel/BuiltinChannels.js'
import {EventsResult, FileResult, StatusResult} from '../../lib/Result.js'
import {Prompt, PromptStreams} from './Prompt.js'

/**
 * The JSON schema of a property of the input of an action
 */
export type PropertySchema = {
    type?: string | string[]
    enum?: unknown[]
    items?: PropertySchema
    default?: unknown
    description?: string
    format?: string
    [key: string]: unknown
}

export type CommanderCLIEntrypointOptions = {
    /**
     * The adapter name
     */
    name?: string
    /**
     * The program name shown in the help, the name of the script by default
     */
    bin?: string
    /**
     * The description of the program shown in the help
     */
    description?: string
    /**
     * The version of the program, adds the -V, --version option
     */
    version?: string
    /**
     * The arguments of the user, process.argv.slice(2) by default
     */
    argv?: string[]
    /**
     * Prompt for the missing required options:
     * 'auto' (default) when the input and the output are terminals and @inquirer/prompts is installed,
     * true to prompt whenever @inquirer/prompts is installed, false to never prompt
     */
    interactive?: boolean | 'auto'
    /**
     * The input of the prompts, process.stdin by default
     */
    stdin?: NodeJS.ReadableStream
    /**
     * The output of the results and of the help, process.stdout by default
     */
    stdout?: NodeJS.WritableStream
    /**
     * The output of the errors, process.stderr by default
     */
    stderr?: NodeJS.WritableStream
    /**
     * How a result is written, a string as it is, a buffer as its bytes and the other values as indented JSON by default
     */
    format?: (result: unknown) => string | Uint8Array | undefined
    /**
     * When no command is given: 'help' (default) writes the help and exits with the code 1,
     * 'ignore' leaves the application running (an application which also serves other channels)
     */
    noCommand?: 'help' | 'ignore'
    /**
     * Once a command ended: 'application' (default) exits the application with the code of the command,
     * 'process' only sets the exit code of the process, 'none' does nothing, or a function given the code
     */
    exit?: 'application' | 'process' | 'none' | ((code: number) => void | Promise<void>)
    /**
     * Customize the program (hooks, global options, additional commands) before the arguments are parsed
     */
    configure?: (program: Command) => void | Promise<void>
    /**
     * The middlewares of the actions of this adapter, run after the global middlewares
     */
    middlewares?: MiddlewareDefinition[]
}

/**
 * The type of a property, without null
 * @param schema
 */
function TypeOf(schema: PropertySchema): string | undefined {
    const types: string[] = ([] as string[]).concat(schema.type ?? []).filter((type: string): boolean => type !== 'null')
    if (types.length) return types[0]
    if (schema.enum?.length) return typeof schema.enum[0]
    return undefined
}

/**
 * The kebab case of a property name (deviceId → device-id)
 * @param name
 */
function KebabCase(name: string): string {
    return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase()
}

/**
 * Parse a value of an option by its schema
 * @param schema
 * @param value
 */
function ParseValue(schema: PropertySchema, value: string): unknown {
    let parsed: unknown
    switch (TypeOf(schema)) {
        case 'integer':
        case 'number': {
            parsed = Number(value)
            if (value.trim() === '' || Number.isNaN(parsed)) throw new InvalidArgumentError('Not a number.')
            break
        }
        case 'boolean': {
            if (!['true', 'false'].includes(value)) throw new InvalidArgumentError('Not a boolean.')
            parsed = value === 'true'
            break
        }
        case 'object': {
            try {
                parsed = JSON.parse(value)
            } catch {
                throw new InvalidArgumentError('Not a JSON object.')
            }
            break
        }
        default:
            parsed = value
    }
    if (schema.enum && !schema.enum.includes(parsed)) throw new InvalidArgumentError(`Allowed choices are ${schema.enum.map((choice: unknown): string => JSON.stringify(choice)).join(', ')}.`)
    return parsed
}

/**
 * The option of a property
 * @param property
 * @param schema
 * @param mandatory
 */
function PropertyOption(property: string, schema: PropertySchema, mandatory: boolean): Option[] {
    const flag: string = `--${KebabCase(property)}`
    const hints: string[] = []
    const choices: unknown[] | undefined = schema.enum ?? schema.items?.enum
    if (choices) hints.push(`choices: ${choices.map((choice: unknown): string => JSON.stringify(choice)).join(', ')}`)
    if (schema.default !== undefined) hints.push(`default: ${JSON.stringify(schema.default)}`)
    const description: string = [schema.description ?? '', hints.length ? `(${hints.join(', ')})` : ''].filter((part: string): boolean => !!part).join(' ')
    const type: string | undefined = TypeOf(schema)
    if (type === 'boolean') {
        const options: Option[] = [new Option(flag, description)]
        //A flag on by default is turned off by its negation
        if (schema.default === true) options.push(new Option(`--no-${KebabCase(property)}`, `Turn off ${flag}`))
        return options
    }
    const option: Option = type === 'array'
        ? new Option(`${flag} <values...>`, description).argParser((value: string, previous: unknown[] | undefined): unknown[] => [...(Array.isArray(previous) ? previous : []), ParseValue(schema.items ?? {}, value)])
        : new Option(`${flag} <${type === 'object' ? 'json' : 'value'}>`, description).argParser((value: string): unknown => ParseValue(schema, value))
    return [option.makeOptionMandatory(mandatory)]
}

/**
 * The default format of a result
 * @param result
 */
function DefaultFormat(result: unknown): string | Uint8Array | undefined {
    if (result === undefined || result === null) return undefined
    if (typeof result === 'string') return result.endsWith('\n') ? result : `${result}\n`
    if (result instanceof Uint8Array) return result
    return `${JSON.stringify(result, (key: string, value: unknown): unknown => typeof value === 'bigint' ? value.toString() : value, 2)}\n`
}

/**
 * The message of an error
 * @param error
 */
function ErrorMessage(error: unknown): string {
    if (error && typeof error === 'object') {
        const {errMsg, message} = error as { errMsg?: unknown, message?: unknown }
        if (typeof errMsg === 'string' && errMsg) return errMsg
        if (typeof message === 'string' && message) return message
    }
    return String(error)
}

/**
 * The application a module belongs to
 * @param module
 */
function ApplicationOf(module: unknown): Application | undefined {
    let target: any = module
    while (target && !(target instanceof Application)) target = target.getParent?.()
    return target
}

/**
 * The CLI entrypoint parsing the arguments with commander: each CLI action is a command whose options are the properties of its input
 * @param options
 */
export function CommanderCLIEntrypoint(options: CommanderCLIEntrypointOptions = {}): EntrypointAdapter<CLIContext> {
    const stdout: NodeJS.WritableStream = options.stdout ?? process.stdout
    const stderr: NodeJS.WritableStream = options.stderr ?? process.stderr
    const stdin: NodeJS.ReadableStream = options.stdin ?? process.stdin
    const format: (result: unknown) => string | Uint8Array | undefined = options.format ?? DefaultFormat
    //Aborts the prompts and the event streams when the adapter stops
    const stopController: AbortController = new AbortController()

    const write = (output: string | Uint8Array | undefined): void => {
        if (output !== undefined && output.length) stdout.write(output)
    }

    /**
     * Write the result of an action
     * @param result
     */
    const output = async (result: unknown): Promise<void> => {
        if (result instanceof EventsResult) {
            return await result.producer((data: unknown): void => {
                if (!stopController.signal.aborted) write(format(data))
            }, stopController.signal)
        }
        if (result instanceof FileResult) {
            const source: string | Buffer | Readable = result.source
            if (Buffer.isBuffer(source)) return write(source)
            const stream: Readable = typeof source === 'string' ? createReadStream(path.resolve(source)) : source
            return await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
                stream.once('error', reject).once('end', resolve).pipe(stdout, {end: false})
            })
        }
        write(format(result instanceof StatusResult ? result.data : result))
    }

    /**
     * Whether the missing options are prompted
     */
    const interactive = (): boolean => {
        if (options.interactive === false) return false
        if (options.interactive === true) return true
        return !!(stdin as { isTTY?: boolean }).isTTY && !!(stdout as { isTTY?: boolean }).isTTY
    }

    /**
     * Run a command
     * @param runtime
     * @param action
     * @param data
     * @param prompting
     */
    const execute = async (runtime: ChannelRuntime<CLIContext>, action: ChannelActionInfo, data: Record<string, unknown>, prompting: boolean): Promise<number> => {
        try {
            if (prompting) await Prompt(action, data, {input: stdin, output: stdout, signal: stopController.signal} satisfies PromptStreams)
            const context: CLIContext = new CLIContext({command: action.address.command, data: data})
            await output(await runtime.dispatchTo(action, context))
            return 0
        } catch (error: unknown) {
            stderr.write(`error: ${ErrorMessage(error)}\n`)
            return 1
        }
    }

    /**
     * Parse the arguments and run the command
     * @param runtime
     */
    const run = async (runtime: ChannelRuntime<CLIContext>): Promise<number | undefined> => {
        const argv: string[] = options.argv ?? process.argv.slice(2)
        if (!argv.length && options.noCommand === 'ignore') return undefined
        const prompting: boolean = interactive()
        const program: Command = new Command(options.bin ?? path.basename(process.argv[1] ?? 'cli', path.extname(process.argv[1] ?? '')))
            .exitOverride()
            .configureOutput({
                writeOut: (text: string): unknown => stdout.write(text),
                writeErr: (text: string): unknown => stderr.write(text)
            })
        if (options.description) program.description(options.description)
        if (options.version) program.version(options.version)
        let code: number = 0
        for (const action of runtime.actions) {
            const schema: { properties?: Record<string, PropertySchema>, required?: string[] } = action.jsonSchema as any
            const required: Set<string> = new Set(schema.required ?? [])
            const command: Command = program.command(action.address.command).description(action.description || action.name).allowExcessArguments(false)
            //The properties by the attribute names of their options
            const properties: Map<string, string> = new Map()
            for (const [property, propertySchema] of Object.entries(schema.properties ?? {})) {
                const mandatory: boolean = !prompting && required.has(property) && propertySchema.default === undefined
                for (const option of PropertyOption(property, propertySchema, mandatory)) {
                    command.addOption(option)
                    properties.set(option.attributeName(), property)
                }
            }
            command.action(async (): Promise<void> => {
                const data: Record<string, unknown> = {}
                for (const [attribute, value] of Object.entries(command.opts())) {
                    if (value !== undefined && properties.has(attribute)) data[properties.get(attribute)!] = value
                }
                code = await execute(runtime, action, data, prompting)
            })
        }
        await options.configure?.(program)
        try {
            await program.parseAsync(argv, {from: 'user'})
        } catch (error: unknown) {
            if (error instanceof CommanderError) return error.exitCode
            throw error
        }
        return code
    }

    /**
     * End with the code of the command
     * @param runtime
     * @param code
     */
    const exit = async (runtime: ChannelRuntime<CLIContext>, code: number): Promise<void> => {
        const mode: CommanderCLIEntrypointOptions['exit'] = options.exit ?? 'application'
        if (typeof mode === 'function') return await mode(code)
        if (mode === 'none') return
        const application: Application | undefined = mode === 'application' ? ApplicationOf(runtime.module) : undefined
        if (application) return application.exit(code)
        process.exitCode = code
    }

    return {
        channel: 'cli',
        definition: CLIChannel,
        name: options.name,
        middlewares: options.middlewares,
        start: (runtime: ChannelRuntime<CLIContext>): void => {
            //The command runs once the application launched: every object, the bootstrap and the other adapters are ready
            runtime.ready
                .then((): Promise<number | undefined> | undefined => stopController.signal.aborted ? undefined : run(runtime))
                .catch((error: unknown): number => {
                    stderr.write(`error: ${ErrorMessage(error)}\n`)
                    return 1
                })
                .then((code: number | undefined): unknown => code === undefined || stopController.signal.aborted ? undefined : exit(runtime, code))
                .catch((error: unknown): unknown => stderr.write(`error: ${ErrorMessage(error)}\n`))
        },
        stop: (): void => {
            //A command not started yet is not run, the prompts and the event streams are ended
            stopController.abort()
        }
    }
}
