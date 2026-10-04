//Derived from the upstream projects listed in THIRD_PARTY_NOTICES.md (rewritten in TypeScript)
import {hostname} from 'node:os'
import {Format} from './Format.js'
import {SerializeError, SerializeRequest, SerializeResponse} from './Serializers.js'
import {Stringify} from './Stringify.js'

export const LEVELS: Record<string, number> = {trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60, silent: Infinity}

const HOSTNAME: string = hostname()

/**
 * The JSON of a log value, undefined if it is not logged
 * @param value
 */
function ValueJSON(value: unknown): string | undefined {
    switch (typeof value) {
        case 'undefined':
        case 'function':
            return undefined
        case 'number':
            return Number.isFinite(value) ? String(value) : 'null'
        case 'boolean':
            return String(value)
        case 'string':
            return JSON.stringify(value)
        default:
            return Stringify(value)
    }
}

export type LogBindings = {
    json: string
    name: string
}

export type LogRecord = {
    //The JSON log line, terminated by a new line
    line: string
    //The parsed line, if it was requested and the line is valid JSON
    log?: Record<string, unknown>
}

/**
 * The bindings of the log lines of an application: pid, hostname and name
 * @param name
 */
export function Bindings(name: string): LogBindings {
    return {json: `,"pid":${process.pid},"hostname":${JSON.stringify(HOSTNAME)},"name":${JSON.stringify(name)}`, name: name}
}

/**
 * The value of a JSON text, as parsed
 * @param value
 * @param json
 */
function ParsedValue(value: unknown, json: string): unknown {
    switch (typeof value) {
        case 'string':
        case 'boolean':
            return value
        case 'number':
            return Number.isFinite(value) ? value + 0 : null
        default:
            return JSON.parse(json)
    }
}

/**
 * Set a property of a parsed log, as JSON.parse does (the first position and the last value of a key)
 * @param log
 * @param key
 * @param value
 */
function SetParsed(log: Record<string, unknown>, key: string, value: unknown): void {
    key === '__proto__' ? Object.defineProperty(log, key, {value: value, enumerable: true, writable: true, configurable: true}) : log[key] = value
}

/**
 * Build a JSON log line from the arguments of a log method:
 * an object (or error, HTTP request or response) with an optional message and its format arguments,
 * or a message with its format arguments
 * @param level
 * @param bindings
 * @param args
 * @param parse whether to also build the parsed line
 * @param redacted the lower-case names of the headers of an HTTP request or response written as [Redacted]
 */
export function BuildRecord(level: number, bindings: LogBindings, args: unknown[], parse: boolean = false, redacted: ReadonlySet<string> = new Set()): LogRecord {
    let object: any = null
    let message: unknown
    let [first, ...rest] = args
    if (typeof first === 'object') {
        message = first
        if (first !== null) {
            if ((first as any).method && (first as any).headers && (first as any).socket) {
                first = {req: SerializeRequest(first, redacted)}
            } else if (typeof (first as any).setHeader === 'function') {
                first = {res: SerializeResponse(first, redacted)}
            }
        }
        let formatArgs: unknown[]
        if (message === null && !rest.length) {
            formatArgs = [null]
        } else {
            message = rest.shift()
            formatArgs = rest
        }
        object = first
        message = Format(message, formatArgs)
    } else {
        message = Format(first === undefined ? rest.shift() : first, rest)
    }
    if (object === undefined || object === null) {
        object = {}
    } else if (object instanceof Error) {
        if (message === undefined) message = object.message
        object = {err: object}
    } else if (message === undefined && object.msg === undefined && object.err) {
        message = object.err.message
    }
    const time: number = Date.now()
    let line: string = `{"level":${level},"time":${time}${bindings.json}`
    const log: Record<string, unknown> | undefined = parse ? {level: level, time: time, pid: process.pid, hostname: HOSTNAME, name: bindings.name} : undefined
    for (const key in object) {
        let value: unknown = object[key]
        if (!Object.prototype.hasOwnProperty.call(object, key) || value === undefined) continue
        if (key === 'err') value = SerializeError(value)
        const json: string | undefined = ValueJSON(value)
        if (json === undefined) continue
        line += `,${JSON.stringify(key)}:${json}`
        if (log) SetParsed(log, key, ParsedValue(value, json))
    }
    if (message !== undefined && typeof message !== 'function') {
        const json: string | undefined = typeof message === 'string' ? JSON.stringify(message) : ValueJSON(message)
        //A message which cannot be serialized (a symbol) is omitted
        if (json !== undefined) {
            line += `,"msg":${json}`
            if (log) SetParsed(log, 'msg', ParsedValue(message, json))
        }
    }
    return {line: `${line}}\n`, log: log}
}
