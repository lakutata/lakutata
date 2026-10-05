import {Argument, Command, CommanderError, InvalidArgumentError, Option} from 'commander'
import {createReadStream} from 'node:fs'
import path from 'node:path'
import type {Readable} from 'node:stream'
import {type Application, type Module} from '@lakutata/core'
import {applicationOf} from '../../lib/ApplicationOf.js'
import type {ChannelActionInfo, ChannelRuntime, EntrypointAdapter} from '../../channel/EntrypointAdapter.js'
import type {MiddlewareDefinition} from '../../lib/Middleware.js'
import {CLIContext} from '../../context/CLIContext.js'
import {CLIChannel} from '../../channel/BuiltinChannels.js'
import {EventsResult, FileResult, StatusResult} from '../../lib/Result.js'
import {loadPrompts, prompt, PromptStreams} from './Prompt.js'
import {boxWrap, displayWidth} from './Width.js'

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
 * A text of the help or of the prompts of {@link commanderCLIEntrypoint}, given to its `translate` function.
 */
export type CLIText = {
    /**
     * The key identifying the text: `description` (the program), `commands.<command>.description`,
     * `commands.<command>.options.<property>`, `commands.<command>.arguments.<name>` (a nested command's words are joined
     * with dots: `package.exe`), the help titles and labels (`help.usage`, `help.options`, `help.commands`,
     * `help.default`, `help.choices`…), the prompt messages (`prompt.json`).
     */
    key: string
    /**
     * The English text, with its `{name}` placeholders.
     */
    text: string
    /**
     * The values of the text's `{name}` placeholders, by name.
     */
    params?: Record<string, string>
}

/**
 * Translate a text of the help or of the prompts into the user's language: return the translated text, its `{name}`
 * placeholders filled from `params`.
 */
export type CLITranslate = (text: CLIText) => string

/**
 * The options of {@link commanderCLIEntrypoint}.
 */
export type CommanderCLIEntrypointOptions = {
    /**
     * The adapter name, to tell apart several CLI adapters of one entrypoint.
     */
    name?: string
    /**
     * The program name shown in the help.
     * @default the name of the script run, without its extension
     */
    bin?: string
    /**
     * The program description shown in the help.
     */
    description?: string
    /**
     * The descriptions of the command groups, by group name: the first words of the nested commands (`'package'` for
     * the command `'package exe <file>'`), whose help (`tool package --help`) lists their commands.
     */
    groups?: Record<string, string>
    /**
     * The program version; adds the `-V, --version` option.
     */
    version?: string
    /**
     * The command-line arguments to parse, without the node executable and the script.
     * @default process.argv.slice(2)
     */
    argv?: string[]
    /**
     * Prompt for the missing required options (it needs the optional package `@inquirer/prompts`): `'auto'` when both
     * stdin and stdout are terminals, `true` always, `false` never. While prompting is on, the required options are not
     * enforced by the parser; without `@inquirer/prompts` installed, prompting is off (the parser requires them).
     * @default 'auto'
     */
    interactive?: boolean | 'auto'
    /**
     * The input stream of the prompts.
     * @default process.stdin
     */
    stdin?: NodeJS.ReadableStream
    /**
     * The output stream of the results, the help and the prompts.
     * @default process.stdout
     */
    stdout?: NodeJS.WritableStream
    /**
     * The output stream of the errors.
     * @default process.stderr
     */
    stderr?: NodeJS.WritableStream
    /**
     * Turn an action's result into the text or bytes written to stdout; `undefined` writes nothing.
     * @default a string as is (with a final newline), bytes as is, `null` and `undefined` as nothing, any other value as
     * indented JSON (the bigints as strings)
     */
    format?: (result: unknown) => string | Uint8Array | undefined
    /**
     * What happens when no argument is given: `'help'` writes the help and ends with the code 1, `'ignore'` runs no
     * command and leaves the application running (an application also serving other channels).
     * @default 'help'
     */
    noCommand?: 'help' | 'ignore'
    /**
     * What happens once the command ended, with its exit code (0 on success, 1 on failure, the parser's code for a
     * usage error): `'application'` exits the application with the code, `'process'` only sets `process.exitCode`,
     * `'none'` does nothing, or a function receiving the code.
     * @default 'application'
     */
    exit?: 'application' | 'process' | 'none' | ((code: number) => void | Promise<void>)
    /**
     * Customize the commander program (hooks, global options, additional commands) after the action commands are
     * added and before the arguments are parsed.
     */
    configure?: (program: Command) => void | Promise<void>
    /**
     * The middlewares of this adapter's actions, run after the entrypoint's global middlewares.
     */
    middlewares?: MiddlewareDefinition[]
    /**
     * Translate the texts of the help and of the prompts (the program, command, argument and option descriptions, the
     * help titles) into the user's language: given the entrypoint's module when the arguments are parsed, it returns the
     * translating function (`commanderTranslator` of `lakutata/com/i18n` returns the one of an i18n component). The
     * command and option names are never translated.
     * @default the English texts
     */
    translate?: (module: Module) => CLITranslate | Promise<CLITranslate>
}

/**
 * The English texts, their arguments filled
 * @param text
 */
function english(text: CLIText): string {
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
function typeOf(schema: PropertySchema): string | undefined {
    const types: string[] = ([] as string[]).concat(schema.type ?? []).filter((type: string): boolean => type !== 'null')
    if (types.length) return types[0]
    if (schema.enum?.length) return typeof schema.enum[0]
    return undefined
}

/**
 * The kebab case of a property name (deviceId → device-id)
 * @param name
 */
function kebabCase(name: string): string {
    return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase()
}

/**
 * Parse a value of an option by its schema
 * @param schema
 * @param value
 */
function parseValue(schema: PropertySchema, value: string): unknown {
    let parsed: unknown
    switch (typeOf(schema)) {
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
function propertyOption(property: string, schema: PropertySchema, mandatory: boolean, say: (key: string, text: string, params?: Record<string, string>) => string, command: string): Option[] {
    const flag: string = `--${kebabCase(property)}`
    //A boolean or a value (DTO.Alternatives(DTO.Boolean(), …)): a flag taking an optional value
    const alternatives: PropertySchema[] = Array.isArray(schema.anyOf) ? schema.anyOf as PropertySchema[] : []
    const valued: PropertySchema | undefined = alternatives.some((alternative: PropertySchema): boolean => typeOf(alternative) === 'boolean')
        ? alternatives.find((alternative: PropertySchema): boolean => typeOf(alternative) !== 'boolean')
        : undefined
    const hints: string[] = []
    const choices: unknown[] | undefined = schema.enum ?? schema.items?.enum ?? valued?.enum
    if (choices) hints.push(say('help.choices', 'choices: {choices}', {choices: choices.map((choice: unknown): string => JSON.stringify(choice)).join(', ')}))
    if (schema.default !== undefined) hints.push(say('help.default', 'default: {value}', {value: JSON.stringify(schema.default)}))
    const text: string = schema.description ? say(`commands.${command}.options.${property}`, schema.description) : ''
    //The hints after the description, " (default: 1)"
    const description: string = hints.length ? `${text}${say('help.hints', ' ({hints})', {hints: hints.join(say('help.separator', ', '))})}`.trim() : text
    //--flag gives true, --flag <value> the value
    if (valued) return [new Option(`${flag} [value]`, description).argParser((value: string): unknown => parseValue(valued, value))]
    const type: string | undefined = typeOf(schema)
    if (type === 'boolean') {
        const options: Option[] = [new Option(flag, description)]
        //A flag on by default is turned off by its negation
        if (schema.default === true) options.push(new Option(`--no-${kebabCase(property)}`, say('help.negate', 'Turn off {flag}', {flag: flag})))
        return options
    }
    const option: Option = type === 'array'
        ? new Option(`${flag} <values...>`, description).argParser((value: string, previous: unknown[] | undefined): unknown[] => [...(Array.isArray(previous) ? previous : []), parseValue(schema.items ?? {}, value)])
        : new Option(`${flag} <${type === 'object' ? 'json' : 'value'}>`, description).argParser((value: string): unknown => parseValue(schema, value))
    return [option.makeOptionMandatory(mandatory)]
}

/**
 * The default format of a result
 * @param result
 */
function defaultFormat(result: unknown): string | Uint8Array | undefined {
    if (result === undefined || result === null) return undefined
    if (typeof result === 'string') return result.endsWith('\n') ? result : `${result}\n`
    if (result instanceof Uint8Array) return result
    return `${JSON.stringify(result, (key: string, value: unknown): unknown => typeof value === 'bigint' ? value.toString() : value, 2)}\n`
}

/**
 * The message of an error
 * @param error
 */
function errorMessage(error: unknown): string {
    if (error && typeof error === 'object') {
        const {errMsg, message} = error as { errMsg?: unknown, message?: unknown }
        if (typeof errMsg === 'string' && errMsg) return errMsg
        if (typeof message === 'string' && message) return message
    }
    return String(error)
}

/**
 * Create the CLI adapter of an entrypoint, parsing the command-line arguments with commander: each CLI action
 * (`@CLIAction`) becomes a command, and the properties of its input DTO become its options. It needs the optional peer
 * dependency `commander` (and `@inquirer/prompts` for the interactive prompts).
 *
 * A property becomes a kebab-case option (`deviceId` → `--device-id <value>`), parsed by its type: a number, `true` or
 * `false`, a JSON object, an array (`--tags <values...>`), a boolean as a flag (with a `--no-<name>` negation when it
 * defaults to `true`); the enums, the defaults and the descriptions appear in the help. The command text may declare
 * positional arguments, given to the properties of their names (`'copy <files...> [target]'`), and its leading words
 * before the last one name its groups (`'package exe <file>'` is the command `exe` of the group `package`).
 *
 * The command runs once the application has launched (all its objects, its bootstrap and the other adapters are
 * ready). Its result is written to stdout (see `format`; an `EventsResult` writes each event's data, a `FileResult`
 * the file's bytes); a failure writes `error: <message>` to stderr and ends with the code 1. Then the application exits
 * with the command's code (see `exit`). When the entrypoint stops first, a command not started yet does not run, and
 * the prompts and the event streams end.
 * @param options The adapter options; by default it parses `process.argv`, prompts in a terminal, and exits the
 * application once the command ended.
 * @returns The adapter, to give to the `cli` option of `buildEntrypoints`.
 * @example
 * ```typescript
 * import {Application, DTO} from 'lakutata'
 * import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
 * import {CLIAction} from 'lakutata/decorator/ctrl'
 * import {Expect} from 'lakutata/decorator/dto'
 * import {commanderCLIEntrypoint} from 'lakutata/adapter/commander'
 *
 * class GreetDTO extends DTO {
 *     @Expect(DTO.String().required().description('The name to greet'))
 *     public name!: string
 *
 *     @Expect(DTO.Number().integer().optional().default(1).description('How many times'))
 *     public times?: number
 *
 *     @Expect(DTO.Boolean().optional().default(false))
 *     public loud?: boolean
 * }
 *
 * class GreetController extends Controller {
 *     //tool greet Ada --times 2 --loud
 *     @CLIAction('greet <name>', GreetDTO)
 *     public async greet(input: GreetDTO): Promise<string> {
 *         const text: string = `Hello, ${input.name}`
 *         return (input.loud ? text.toUpperCase() : text).repeat(input.times ?? 1)
 *     }
 * }
 *
 * Application.run({
 *     id: 'tool.app',
 *     name: 'Tool',
 *     components: {
 *         entrypoint: buildEntrypoints({
 *             controllers: [GreetController],
 *             cli: commanderCLIEntrypoint({bin: 'tool', description: 'A greeting tool', version: '1.0.0'})
 *         })
 *     }
 * })
 * ```
 */
export function commanderCLIEntrypoint(options: CommanderCLIEntrypointOptions = {}): EntrypointAdapter<CLIContext> {
    const stdout: NodeJS.WritableStream = options.stdout ?? process.stdout
    const stderr: NodeJS.WritableStream = options.stderr ?? process.stderr
    const stdin: NodeJS.ReadableStream = options.stdin ?? process.stdin
    const format: (result: unknown) => string | Uint8Array | undefined = options.format ?? defaultFormat
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
     * Whether the missing options are prompted: the prompts installed (else the parser requires the options)
     */
    const interactive = async (): Promise<boolean> => {
        if (options.interactive === false) return false
        if (options.interactive !== true && !((stdin as { isTTY?: boolean }).isTTY && (stdout as { isTTY?: boolean }).isTTY)) return false
        return !!(await loadPrompts())
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
            if (prompting) await prompt(action, data, {input: stdin, output: stdout, signal: stopController.signal} satisfies PromptStreams, describe, say)
            const context: CLIContext = new CLIContext({command: action.address.command, data: data})
            await output(await runtime.dispatchTo(action, context))
            return 0
        } catch (error: unknown) {
            stderr.write(`error: ${errorMessage(error)}\n`)
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
        const prompting: boolean = await interactive()
        //The texts of the help and of the prompts in the language of the user
        const translate: CLITranslate = options.translate ? await options.translate(runtime.module) : english
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
                    displayWidth: displayWidth,
                    boxWrap: (text: string, width: number): string => boxWrap(text, width)
                })
                .helpOption('-h, --help', say('help.helpOption', 'display help for command'))
            if (runtime.actions.length) program.helpCommand('help [command]', say('help.helpCommand', 'display help for command'))
        }
        if (options.description) program.description(say('description', options.description))
        /**
         * A group of commands, its help listing them
         * @param parent
         * @param group its name
         * @param names the names of its groups and its own
         */
        const commandGroup = (parent: Command, group: string, names: string[]): Command => {
            const created: Command = parent.command(group)
            const description: string | undefined = options.groups?.[names.join(' ')]
            if (description) created.description(say(`commands.${names.join('.')}.description`, description))
            if (options.translate) created.helpCommand('help [command]', say('help.helpCommand', 'display help for command'))
            return created
        }
        if (options.version) program.version(options.version, '-V, --version', say('help.versionOption', 'output the version number'))
        let code: number = 0
        for (const action of runtime.actions) {
            const schema: { properties?: Record<string, PropertySchema>, required?: string[] } = action.jsonSchema as any
            const required: Set<string> = new Set(schema.required ?? [])
            //The command may declare positional arguments ("run <script>", "copy <files...> [target]"), given to the properties of their names;
            //its words before them but the last are its groups ("package exe <file>": the command exe of the group package)
            const words: string[] = action.address.command.trim().split(/\s+/)
            const first: number = words.findIndex((word: string): boolean => /^[<[]/.test(word))
            const names: string[] = first < 0 ? words : words.slice(0, first)
            let parent: Command = program
            names.slice(0, -1).forEach((group: string, index: number): void => {
                parent = parent.commands.find((existing: Command): boolean => existing.name() === group) ?? commandGroup(parent, group, names.slice(0, index + 1))
            })
            const command: Command = parent.command([names.at(-1), ...words.slice(names.length)].join(' ')).allowExcessArguments(false)
            //The key of its texts: the names of its groups and its own
            const name: string = names.join('.')
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
                    argument.argParser((value: string, previous: unknown[] | undefined): unknown[] => [...(Array.isArray(previous) ? previous : []), parseValue(propertySchema.items ?? {}, value)])
                } else {
                    argument.argParser((value: string): unknown => parseValue(propertySchema, value))
                }
            }
            //The properties by the attribute names of their options
            const properties: Map<string, string> = new Map()
            for (const [property, propertySchema] of Object.entries(schema.properties ?? {})) {
                if (positional.includes(property)) continue
                const mandatory: boolean = !prompting && required.has(property) && propertySchema.default === undefined
                for (const option of propertyOption(property, propertySchema, mandatory, say, name)) {
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
        const application: Application | undefined = mode === 'application' ? applicationOf(runtime.module) : undefined
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
                    stderr.write(`error: ${errorMessage(error)}\n`)
                    return 1
                })
                .then((code: number | undefined): unknown => code === undefined || stopController.signal.aborted ? undefined : exit(runtime, code))
                .catch((error: unknown): unknown => stderr.write(`error: ${errorMessage(error)}\n`))
        },
        stop: (): void => {
            //A command not started yet is not run, the prompts and the event streams are ended
            stopController.abort()
        }
    }
}
