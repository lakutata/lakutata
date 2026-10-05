import {readFile} from 'node:fs/promises'
import path from 'node:path'
import type {Readable} from 'node:stream'
import {EventsResult, FileResult, StatusResult} from '@lakutata/entrypoint'
import {isCallToolResult, type CallToolResult, type ContentBlock, type GetPromptResult, type PromptMessage, type ReadResourceResult} from '@modelcontextprotocol/server'

/**
 * JSON with the big integers as strings
 * @param value
 */
function Stringify(value: unknown): string {
    return JSON.stringify(value, (key: string, item: unknown): unknown => typeof item === 'bigint' ? item.toString() : item, 2)
}

/**
 * Whether a value is a plain object
 * @param value
 */
function IsPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object') return false
    const prototype: unknown = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

/**
 * Whether a content type is a text
 * @param mimeType
 */
function IsText(mimeType: string): boolean {
    return mimeType.startsWith('text/') || /[/+]json$/.test(mimeType) || /[/+]xml$/.test(mimeType)
}

/**
 * The bytes of a file result
 * @param source
 */
async function ReadSource(source: string | Buffer | Readable): Promise<Buffer> {
    if (Buffer.isBuffer(source)) return source
    if (typeof source === 'string') return await readFile(path.resolve(source))
    const chunks: Buffer[] = []
    for await (const chunk of source) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks)
}

/**
 * The event streams have no MCP result
 */
function EventsNotSupported(): TypeError {
    return new TypeError('The event streams are not results of MCP actions, report the progress with context.progress() instead')
}

/**
 * The content of a file: an image, an audio clip, a text or an embedded resource
 * @param result
 */
async function FileContent(result: FileResult): Promise<ContentBlock> {
    const data: Buffer = await ReadSource(result.source)
    const filename: string | undefined = result.options.filename ?? (typeof result.source === 'string' ? path.basename(result.source) : undefined)
    const mimeType: string = result.options.contentType ?? 'application/octet-stream'
    if (mimeType.startsWith('image/')) return {type: 'image', data: data.toString('base64'), mimeType: mimeType}
    if (mimeType.startsWith('audio/')) return {type: 'audio', data: data.toString('base64'), mimeType: mimeType}
    const uri: string = `file:///${encodeURIComponent(filename ?? 'result')}`
    if (IsText(mimeType)) return {type: 'resource', resource: {uri: uri, mimeType: mimeType, text: data.toString('utf8')}}
    return {type: 'resource', resource: {uri: uri, mimeType: mimeType, blob: data.toString('base64')}}
}

/**
 * Convert the value an action returns into the result of a tool call (`CallToolResult`), as the MCP adapters do:
 * - `undefined` or `null`: an empty result (no content);
 * - a string: one text;
 * - a `CallToolResult` (`{content: [...]}`): itself;
 * - `Result.file()`: an image or an audio clip (base64) by its content type, else an embedded resource (a text for the
 *   text, JSON and XML types, a blob otherwise; `application/octet-stream` without a type);
 * - `Result.status()`: its data, converted;
 * - a plain object: its JSON as a text, and the object as the structured content;
 * - a class instance, such as a DTO: its JSON as a text; with `output`, also the structured content, when its JSON is
 *   an object (its own enumerable properties, or what its `toJSON()` returns);
 * - another value (an array, a number): its JSON as a text, without structured content.
 *
 * The JSON is indented, and its bigints are written as strings.
 * @param result The value the action returned.
 * @param output Whether the tool declares an output schema (`@MCPTool(…, {output})`), as the adapters tell it: the
 * class instances then give their structured content too. The values which cannot be an object (a string, an array,
 * `undefined`) still have none: the adapters answer them with an error result naming the action. Default `false`.
 * @returns The tool result.
 * @throws {TypeError} When the result is an event stream (`Result.events()`): report the progress with
 * `context.progress()` instead.
 * @throws {Error} When the file of `Result.file()` cannot be read.
 * @example
 * ```typescript
 * import {toToolResult} from '@lakutata/mcp'
 *
 * //{content: [{type: 'text', text: '{\n  "sn": "A1"\n}'}], structuredContent: {sn: 'A1'}}
 * console.log(await toToolResult({sn: 'A1'}))
 * //{content: [{type: 'text', text: 'done'}]}
 * console.log(await toToolResult('done'))
 * ```
 */
export async function toToolResult(result: unknown, output: boolean = false): Promise<CallToolResult> {
    if (result instanceof StatusResult) return await toToolResult(result.data, output)
    if (result instanceof FileResult) return {content: [await FileContent(result)]}
    if (result instanceof EventsResult) throw EventsNotSupported()
    if (result === undefined || result === null) return {content: []}
    if (typeof result === 'string') return {content: [{type: 'text', text: result}]}
    if (isCallToolResult(result)) return result as CallToolResult
    const text: string = Stringify(result)
    const toolResult: CallToolResult = {content: [{type: 'text', text: text}]}
    //A class instance (a DTO) gives its JSON, an object, as the structured content of a tool declaring an output
    if (IsPlainObject(result) || (output && typeof result === 'object' && !Array.isArray(result))) {
        const structured: unknown = text === undefined ? undefined : JSON.parse(text)
        if (IsPlainObject(structured)) toolResult.structuredContent = structured
    }
    return toolResult
}

/**
 * The type of a value returned by an action, for the error of a tool declaring an output
 * @param result
 */
export function ResultType(result: unknown): string {
    if (result instanceof StatusResult) return ResultType(result.data)
    if (result === undefined || result === null) return String(result)
    if (Array.isArray(result)) return 'an array'
    if (isCallToolResult(result)) return 'a CallToolResult without structuredContent'
    if (typeof result === 'object') return `an instance of ${(result as object).constructor?.name ?? 'Object'}`
    return `${/^[aeiou]/.test(typeof result) ? 'an' : 'a'} ${typeof result}`
}

/**
 * The message of an error
 * @param error
 */
export function ErrorMessage(error: unknown): string {
    const {errno, errMsg, message} = (error && typeof error === 'object' ? error : {}) as { errno?: unknown, errMsg?: unknown, message?: unknown }
    const text: string = typeof errMsg === 'string' && errMsg ? errMsg : typeof message === 'string' && message ? message : String(error)
    return errno === undefined ? text : `${String(errno)}: ${text}`
}

/**
 * Convert an error thrown by an action into the result of a tool call, as the MCP adapters do: the errors of the tools
 * are given to the model, which may correct its input and call the tool again, rather than sent as protocol errors.
 * The result has `isError: true` and one text: `errno: message` for an exception with an `errno`, its message
 * otherwise (its `errMsg`, else its `message`, else the value as a string).
 * @param error The error thrown.
 * @returns The tool result.
 * @example
 * ```typescript
 * import {toErrorResult} from '@lakutata/mcp'
 *
 * //{isError: true, content: [{type: 'text', text: 'The device is offline'}]}
 * console.log(toErrorResult(new Error('The device is offline')))
 * ```
 */
export function toErrorResult(error: unknown): CallToolResult {
    return {isError: true, content: [{type: 'text', text: ErrorMessage(error)}]}
}

/**
 * Convert the value an action returns into the contents of a resource read (`ReadResourceResult`), as the MCP adapters
 * do:
 * - `undefined` or `null`: no contents;
 * - a `ReadResourceResult` (`{contents: [...]}`): itself;
 * - a string: a text, of the type `mimeType` (`text/plain` without it);
 * - a `Uint8Array` (a `Buffer`) or `Result.file()`: a text for the text, JSON and XML types, else a blob (base64); its
 *   type is the file's content type, else `mimeType`, else `application/octet-stream`;
 * - `Result.status()`: its data, converted;
 * - another value: its JSON (indented, bigints as strings), of the type `mimeType` (`application/json` without it).
 * @param uri The URI read, the `uri` of the contents.
 * @param result The value the action returned.
 * @param mimeType The content type the resource declares; none by default.
 * @returns The contents of the resource.
 * @throws {TypeError} When the result is an event stream (`Result.events()`).
 * @throws {Error} When the file of `Result.file()` cannot be read.
 * @example
 * ```typescript
 * import {toResourceResult} from '@lakutata/mcp'
 *
 * //{contents: [{uri: 'device://A1/status', mimeType: 'application/json', text: '{\n  "online": true\n}'}]}
 * console.log(await toResourceResult('device://A1/status', {online: true}))
 * ```
 */
export async function toResourceResult(uri: string, result: unknown, mimeType?: string): Promise<ReadResourceResult> {
    if (result instanceof StatusResult) return await toResourceResult(uri, result.data, mimeType)
    if (result instanceof EventsResult) throw EventsNotSupported()
    if (result === undefined || result === null) return {contents: []}
    if (IsPlainObject(result) && Array.isArray(result.contents)) return result as ReadResourceResult
    if (typeof result === 'string') return {contents: [{uri: uri, mimeType: mimeType ?? 'text/plain', text: result}]}
    if (result instanceof FileResult || result instanceof Uint8Array) {
        const data: Buffer = result instanceof FileResult ? await ReadSource(result.source) : Buffer.from(result)
        const type: string = (result instanceof FileResult ? result.options.contentType : undefined) ?? mimeType ?? 'application/octet-stream'
        return {contents: [IsText(type) ? {uri: uri, mimeType: type, text: data.toString('utf8')} : {uri: uri, mimeType: type, blob: data.toString('base64')}]}
    }
    return {contents: [{uri: uri, mimeType: mimeType ?? 'application/json', text: Stringify(result)}]}
}

/**
 * A message of a prompt
 * @param message
 */
function PromptMessageOf(message: unknown): PromptMessage {
    if (typeof message === 'string') return {role: 'user', content: {type: 'text', text: message}}
    if (IsPlainObject(message) && (message.role === 'user' || message.role === 'assistant') && IsPlainObject(message.content)) return message as unknown as PromptMessage
    return {role: 'user', content: {type: 'text', text: Stringify(message)}}
}

/**
 * Convert the value an action returns into a prompt (`GetPromptResult`), as the MCP adapters do:
 * - `undefined` or `null`: no messages;
 * - a `GetPromptResult` (`{messages: [...]}`): itself, without the description;
 * - a string: one message of the user;
 * - an array: one message per item, a string as a message of the user, a `{role: 'user' | 'assistant', content}`
 *   object as it is, another value as a message of the user holding its JSON;
 * - `Result.status()`: its data, converted;
 * - another value: one message of the user holding its JSON.
 * @param result The value the action returned.
 * @param description The prompt's description, added to the result; none by default.
 * @returns The prompt.
 * @throws {TypeError} When the result is a file or an event stream: the prompts are made of messages.
 * @example
 * ```typescript
 * import {toPromptResult} from '@lakutata/mcp'
 *
 * //{description: 'Diagnose a device', messages: [{role: 'user', content: {type: 'text', text: 'Diagnose A1.'}}]}
 * console.log(toPromptResult('Diagnose A1.', 'Diagnose a device'))
 * ```
 */
export function toPromptResult(result: unknown, description?: string): GetPromptResult {
    if (result instanceof StatusResult) return toPromptResult(result.data, description)
    if (result instanceof FileResult || result instanceof EventsResult) throw new TypeError('The prompts are made of messages: strings or {role, content}')
    if (IsPlainObject(result) && Array.isArray(result.messages)) return result as GetPromptResult
    const messages: PromptMessage[] = result === undefined || result === null ? [] : (Array.isArray(result) ? result : [result]).map(PromptMessageOf)
    return description ? {description: description, messages: messages} : {messages: messages}
}
