import {PassThrough} from 'node:stream'
import {DTO} from '@lakutata/core'
import type {ChannelActionInfo} from '../../channel/EntrypointAdapter.js'
import type {PropertySchema} from './CommanderCLIEntrypoint.js'

/**
 * The streams of the prompts
 */
export type PromptStreams = {
    input: NodeJS.ReadableStream
    output: NodeJS.WritableStream
    signal: AbortSignal
}

/**
 * The property names of the secrets, prompted without echo
 */
const SECRET: RegExp = /pass(word)?|secret|token|api[-_]?key|credential/i

/**
 * The prompts, undefined when @inquirer/prompts is not installed
 */
let prompts: Promise<any> | undefined

/**
 * Load the prompts
 */
function LoadPrompts(): Promise<any> {
    prompts ??= import('@inquirer/prompts').catch((): undefined => undefined)
    return prompts
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
 * Validate an answer by the rules of its property in the DTO of the action
 * @param dto
 * @param property
 */
function Validator(dto: typeof DTO, property: string): (value: unknown) => Promise<true | string> {
    let field: any
    try {
        field = (dto.Schema() as any).extract(property).label(property)
    } catch {
        //A property without its own rule is validated with the whole input
        return async (): Promise<true> => true
    }
    return async (value: unknown): Promise<true | string> => {
        try {
            await DTO.validateAsync(value, field)
            return true
        } catch (error: unknown) {
            return (error as { errMsg?: string }).errMsg ?? (error as Error).message
        }
    }
}

/**
 * Prompt for the required properties missing from the input of an action, when @inquirer/prompts is installed
 * @param action
 * @param data
 * @param streams
 * @param describe the description of a property in the language of the user
 * @param say the text of the prompts in the language of the user
 */
export async function Prompt(action: ChannelActionInfo, data: Record<string, unknown>, streams: PromptStreams, describe: (property: string) => string | undefined = (property: string): string | undefined => (action.jsonSchema as { properties?: Record<string, PropertySchema> }).properties?.[property]?.description, say: (key: string, text: string) => string = (key: string, text: string): string => text): Promise<void> {
    const schema: { properties?: Record<string, PropertySchema>, required?: string[] } = action.jsonSchema as any
    const missing: string[] = (schema.required ?? []).filter((property: string): boolean => data[property] === undefined && schema.properties?.[property]?.default === undefined)
    if (!missing.length) return
    const inquirer: any = await LoadPrompts()
    if (!inquirer) return
    for (const property of missing) {
        //A prompt ends its output once answered, the output of the adapter is kept open
        const output: PassThrough = new PassThrough()
        output.pipe(streams.output, {end: false})
        try {
            data[property] = await Ask(inquirer, action, property, schema.properties?.[property] ?? {}, {input: streams.input, output: output, signal: streams.signal}, describe(property), say)
        } finally {
            output.unpipe(streams.output)
        }
    }
}

/**
 * Ask for a property
 * @param inquirer
 * @param action
 * @param property
 * @param propertySchema
 * @param context
 * @param description the description of the property in the language of the user
 * @param say the text of the prompts in the language of the user
 */
async function Ask(inquirer: any, action: ChannelActionInfo, property: string, propertySchema: PropertySchema, context: PromptStreams, description: string | undefined, say: (key: string, text: string) => string): Promise<unknown> {
    const message: string = description ? `${description} (${property})` : property
    const validate: (value: unknown) => Promise<true | string> = Validator(action.dto, property)
    const type: string | undefined = TypeOf(propertySchema)
    const choices = (values: unknown[]): { name: string, value: unknown }[] => values.map((value: unknown): { name: string, value: unknown } => ({name: String(value), value: value}))
    if (type === 'boolean') return await inquirer.confirm({message: message}, context)
    if (propertySchema.enum) return await inquirer.select({message: message, choices: choices(propertySchema.enum)}, context)
    if (type === 'array' && propertySchema.items?.enum) return await inquirer.checkbox({message: message, choices: choices(propertySchema.items.enum), validate: (selected: { value: unknown }[]): Promise<true | string> => validate(selected.map((choice: { value: unknown }): unknown => choice.value))}, context)
    if (type === 'number' || type === 'integer') return await inquirer.number({message: message, required: true, step: type === 'integer' ? 1 : 'any', validate: validate}, context)
    if (type === 'string' && (propertySchema.format === 'password' || SECRET.test(property))) return await inquirer.password({message: message, mask: '*', validate: validate}, context)
    //The arrays are separated by commas, the objects are written in JSON
    const parse = (answer: string): unknown => {
        if (type === 'array') return answer.split(',').map((item: string): string => item.trim()).filter((item: string): boolean => !!item)
        if (type === 'object') return JSON.parse(answer)
        return answer
    }
    return parse(await inquirer.input({
        message: message,
        required: true,
        validate: async (value: string): Promise<true | string> => {
            try {
                return await validate(parse(value))
            } catch {
                return say('prompt.json', 'Not a JSON object')
            }
        }
    }, context))
}
