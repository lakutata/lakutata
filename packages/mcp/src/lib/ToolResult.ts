import {readFile} from 'node:fs/promises'
import path from 'node:path'
import type {Readable} from 'node:stream'
import {EventsResult, FileResult, StatusResult} from '@lakutata/entrypoint'
import {isCallToolResult} from '@modelcontextprotocol/server'
import type {CallToolResult, ContentBlock} from '@modelcontextprotocol/server'

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
    if (mimeType.startsWith('text/') || mimeType === 'application/json') return {type: 'resource', resource: {uri: uri, mimeType: mimeType, text: data.toString('utf8')}}
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
    if (result instanceof EventsResult) throw new TypeError('The event streams are not results of MCP tools, report the progress with context.progress() instead')
    if (result === undefined || result === null) return {content: []}
    if (typeof result === 'string') return {content: [{type: 'text', text: result}]}
    if (isCallToolResult(result)) return result as CallToolResult
    const toolResult: CallToolResult = {content: [{type: 'text', text: Stringify(result)}]}
    if (IsPlainObject(result)) toolResult.structuredContent = JSON.parse(Stringify(result))
    return toolResult
}

/**
 * The tool result of an error: the errors of the tools are given to the model (it may correct its input), they are not protocol errors
 * @param error
 */
export function ToErrorResult(error: unknown): CallToolResult {
    const {errno, errMsg, message} = (error && typeof error === 'object' ? error : {}) as { errno?: unknown, errMsg?: unknown, message?: unknown }
    const text: string = typeof errMsg === 'string' && errMsg ? errMsg : typeof message === 'string' && message ? message : String(error)
    return {isError: true, content: [{type: 'text', text: errno === undefined ? text : `${String(errno)}: ${text}`}]}
}
