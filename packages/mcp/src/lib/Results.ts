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
 * The tool result of the result of an action:
 * a CallToolResult as it is, a string as a text, a file as an image, an audio clip or a resource,
 * the other values as JSON (a plain object is also the structured content)
 * @param result
 */
export async function ToToolResult(result: unknown): Promise<CallToolResult> {
    if (result instanceof StatusResult) return await ToToolResult(result.data)
    if (result instanceof FileResult) return {content: [await FileContent(result)]}
    if (result instanceof EventsResult) throw EventsNotSupported()
    if (result === undefined || result === null) return {content: []}
    if (typeof result === 'string') return {content: [{type: 'text', text: result}]}
    if (isCallToolResult(result)) return result as CallToolResult
    const toolResult: CallToolResult = {content: [{type: 'text', text: Stringify(result)}]}
    if (IsPlainObject(result)) toolResult.structuredContent = JSON.parse(Stringify(result))
    return toolResult
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
 * The tool result of an error: the errors of the tools are given to the model (it may correct its input), they are not protocol errors
 * @param error
 */
export function ToErrorResult(error: unknown): CallToolResult {
    return {isError: true, content: [{type: 'text', text: ErrorMessage(error)}]}
}

/**
 * The contents of a resource read:
 * a ReadResourceResult as it is, a string as a text, bytes and files as a text or a blob by their content type,
 * the other values as JSON
 * @param uri the URI read
 * @param result
 * @param mimeType the content type declared by the resource
 */
export async function ToResourceResult(uri: string, result: unknown, mimeType?: string): Promise<ReadResourceResult> {
    if (result instanceof StatusResult) return await ToResourceResult(uri, result.data, mimeType)
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
 * The prompt of the result of an action:
 * a GetPromptResult as it is, a string as a message of the user, an array as the messages
 * (strings for the user, or {role, content}), the other values as JSON
 * @param result
 * @param description
 */
export function ToPromptResult(result: unknown, description?: string): GetPromptResult {
    if (result instanceof StatusResult) return ToPromptResult(result.data, description)
    if (result instanceof FileResult || result instanceof EventsResult) throw new TypeError('The prompts are made of messages: strings or {role, content}')
    if (IsPlainObject(result) && Array.isArray(result.messages)) return result as GetPromptResult
    const messages: PromptMessage[] = result === undefined || result === null ? [] : (Array.isArray(result) ? result : [result]).map(PromptMessageOf)
    return description ? {description: description, messages: messages} : {messages: messages}
}
