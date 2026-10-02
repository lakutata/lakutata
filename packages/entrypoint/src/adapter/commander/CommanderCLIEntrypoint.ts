import {Argument, Command, CommanderError, InvalidArgumentError, Option} from 'commander'
import {createReadStream} from 'node:fs'
import path from 'node:path'
import type {Readable} from 'node:stream'
import {Application, type Module} from '@lakutata/core'
import type {ChannelActionInfo, ChannelRuntime, EntrypointAdapter} from '../../channel/EntrypointAdapter.js'
import type {MiddlewareDefinition} from '../../lib/Middleware.js'
import {CLIContext} from '../../context/CLIContext.js'
import {CLIChannel} from '../../channel/BuiltinChannels.js'
import {EventsResult, FileResult, StatusResult} from '../../lib/Result.js'
import {Prompt, PromptStreams} from './Prompt.js'
import {BoxWrap, DisplayWidth} from './Width.js'

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

/**
 * A text of the help or of the prompts: its key (commands.<command>.description, commands.<command>.options.<property>,
 * commands.<command>.arguments.<name>, description, help.usage…), its English text and its arguments ({name} in it)
 */
export type CLIText = {
    key: string
    text: string
    params?: Record<string, string>
}

/**
 * The text of the help or of the prompts in the language of the user
 */
export type CLITranslate = (text: CLIText) => string

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
    /**
     * The texts of the help and of the prompts in the language of the user (the descriptions of the program, of its
     * commands, of their arguments and options, the titles of the help): given the module of the adapter when the
     * arguments are parsed, it gives the function translating them (CommanderTranslator of lakutata/com/i18n gives the
     * ones of an i18n component). The names of the commands and of the options are not translated
     */
    translate?: (module: Module) => CLITranslate | Promise<CLITranslate>
}

/**
 * The English texts, their arguments filled
 * @param text
 */
function English(text: CLIText): string {
    return text.text.replace(/\{(\w+)\}/g, (all: string, name: string): string => text.params?.[name] ?? all)
}

/**
 * The keys of the titles of the help of commander
 */
const TITLES: Record<string, string> = {
    'Usage:': 'help.usage',
    'Arguments:': 'help.arguments',
    'Options:': 'help.options',
    'Commands:': 'help.commands',
    'Global Options:': 'help.globalOptions'
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
 * @param say the text of the help in the language of the user
 * @param command the name of the command
 */
function PropertyOption(property: string, schema: PropertySchema, mandatory: boolean, say: (key: string, text: string, params?: Record<string, string>) => string, command: string): Option[] {
    const flag: string = `--${KebabCase(property)}`
    //A boolean or a value (DTO.Alternatives(DTO.Boolean(), …)): a flag taking an optional value
    const alternatives: PropertySchema[] = Array.isArray(schema.anyOf) ? schema.anyOf as PropertySchema[] : []
    const valued: PropertySchema | undefined = alternatives.some((alternative: PropertySchema): boolean => TypeOf(alternative) === 'boolean')
        ? alternatives.find((alternative: PropertySchema): boolean => TypeOf(alternative) !== 'boolean')
        : undefined
    const hints: string[] = []
    const choices: unknown[] | undefined = schema.enum ?? schema.items?.enum ?? valued?.enum
    if (choices) hints.push(say('help.choices', 'choices: {choices}', {choices: choices.map((choice: unknown): string => JSON.stringify(choice)).join(', ')}))
    if (schema.default !== undefined) hints.push(say('help.default', 'default: {value}', {value: JSON.stringify(schema.default)}))
    const text: string = schema.description ? say(`commands.${command}.options.${property}`, schema.description) : ''
    //The hints after the description, " (default: 1)"
    const description: string = hints.length ? `${text}${say('help.hints', ' ({hints})', {hints: hints.join(say('help.separator', ', '))})}`.trim() : text
    //--flag gives true, --flag <value> the value
    if (valued) return [new Option(`${flag} [value]`, description).argParser((value: string): unknown => ParseValue(valued, value))]
    const type: string | undefined = TypeOf(schema)
    if (type === 'boolean') {
        const options: Option[] = [new Option(flag, description)]
        //A flag on by default is turned off by its negation
        if (schema.default === true) options.push(new Option(`--no-${KebabCase(property)}`, say('help.negate', 'Turn off {flag}', {flag: flag})))
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
     * @param describe the description of a property in the language of the user
     * @param say the text of the prompts in the language of the user
     */
    const execute = async (runtime: ChannelRuntime<CLIContext>, action: ChannelActionInfo, data: Record<string, unknown>, prompting: boolean, describe: (property: string) => string | undefined, say: (key: string, text: string) => string): Promise<number> => {
        try {
            if (prompting) await Prompt(action, data, {input: stdin, output: stdout, signal: stopController.signal} satisfies PromptStreams, describe, say)
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
        //The texts of the help and of the prompts in the language of the user
        const translate: CLITranslate = options.translate ? await options.translate(runtime.module) : English
        const say = (key: string, text: string, params?: Record<string, string>): string => translate({key: key, text: text, params: params})
        const program: Command = new Command(options.bin ?? path.basename(process.argv[1] ?? 'cli', path.extname(process.argv[1] ?? '')))
            .exitOverride()
            .configureOutput({
                writeOut: (text: string): unknown => stdout.write(text),
                writeErr: (text: string): unknown => stderr.write(text)
            })
        if (options.translate) {
            //Inherited by the commands created next
            program
                .configureHelp({
                    styleTitle: (title: string): string => TITLES[title] ? say(TITLES[title], title) : title,
                    //The widths of the wide characters (Chinese, Japanese, Korean), their lines wrapped between them
                    displayWidth: DisplayWidth,
                    boxWrap: (text: string, width: number): string => BoxWrap(text, width)
                })
                .helpOption('-h, --help', say('help.helpOption', 'display help for command'))
            if (runtime.actions.length) program.helpCommand('help [command]', say('help.helpCommand', 'display help for command'))
        }
        if (options.description) program.description(say('description', options.description))
        if (options.version) program.version(options.version, '-V, --version', say('help.versionOption', 'output the version number'))
        let code: number = 0
        for (const action of runtime.actions) {
            const schema: { properties?: Record<string, PropertySchema>, required?: string[] } = action.jsonSchema as any
            const required: Set<string> = new Set(schema.required ?? [])
            //The command may declare positional arguments ("run <script>", "copy <files...> [target]"), given to the properties of their names
            const command: Command = program.command(action.address.command).allowExcessArguments(false)
            const name: string = command.name()
            command.description(action.description ? say(`commands.${name}.description`, action.description) : action.name)
            const positional: string[] = command.registeredArguments.map((argument: Argument): string => argument.name())
            //The description of a property: the one of its argument or of its option
            const describe = (property: string): string | undefined => {
                const text: string | undefined = schema.properties?.[property]?.description
                return text ? say(`commands.${name}.${positional.includes(property) ? 'arguments' : 'options'}.${property}`, text) : undefined
            }
            for (const argument of command.registeredArguments) {
                const propertySchema: PropertySchema | undefined = schema.properties?.[argument.name()]
                if (!propertySchema) continue
                if (propertySchema.description) argument.description = describe(argument.name())!
                if (argument.variadic) {
                    argument.argParser((value: string, previous: unknown[] | undefined): unknown[] => [...(Array.isArray(previous) ? previous : []), ParseValue(propertySchema.items ?? {}, value)])
                } else {
                    argument.argParser((value: string): unknown => ParseValue(propertySchema, value))
                }
            }
            //The properties by the attribute names of their options
            const properties: Map<string, string> = new Map()
            for (const [property, propertySchema] of Object.entries(schema.properties ?? {})) {
                if (positional.includes(property)) continue
                const mandatory: boolean = !prompting && required.has(property) && propertySchema.default === undefined
                for (const option of PropertyOption(property, propertySchema, mandatory, say, name)) {
                    command.addOption(option)
                    properties.set(option.attributeName(), property)
                }
            }
            command.action(async (): Promise<void> => {
                const data: Record<string, unknown> = {}
                positional.forEach((name: string, index: number): void => {
                    const value: unknown = command.processedArgs[index]
                    if (value !== undefined) data[name] = value
                })
                for (const [attribute, value] of Object.entries(command.opts())) {
                    if (value !== undefined && properties.has(attribute)) data[properties.get(attribute)!] = value
                }
                code = await execute(runtime, action, data, prompting, describe, say)
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
