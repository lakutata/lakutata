//Derived from the upstream projects listed in THIRD_PARTY_NOTICES.md (rewritten in TypeScript)
import {Palette} from './Colors.js'

const EOL: string = '\n'

const IDENT: string = '    '

const LEVEL_LABELS: Record<string, string> = {default: 'USERLVL', 60: 'FATAL', 50: 'ERROR', 40: 'WARN', 30: 'INFO', 20: 'DEBUG', 10: 'TRACE'}

const LEVEL_NUMBERS: Record<string, number> = {fatal: 60, error: 50, warn: 40, info: 30, debug: 20, trace: 10}

//The keys of the logger, not printed as properties
const LOGGER_KEYS: string[] = ['pid', 'hostname', 'name', 'level', 'time', 'timestamp', 'caller']

const ERROR_KEYS: Set<string> = new Set(['err', 'error'])

/**
 * The JSON of a property value, indented by 2 spaces
 * @param value
 */
function PropertyJSON(value: unknown): string | undefined {
    switch (typeof value) {
        case 'number':
        case 'boolean':
            return String(value)
        case 'string':
            return JSON.stringify(value)
        default:
            return JSON.stringify(value, null, 2)
    }
}

const hasOwn: (object: object, key: PropertyKey) => boolean = Object.hasOwn

//The prototype pollution suspects of a JSON text
const SUSPECT_PROTO: RegExp = /"(?:_|\\u005[Ff])(?:_|\\u005[Ff])(?:p|\\u0070)(?:r|\\u0072)(?:o|\\u006[Ff])(?:t|\\u0074)(?:o|\\u006[Ff])(?:_|\\u005[Ff])(?:_|\\u005[Ff])"\s*:/

const SUSPECT_CONSTRUCTOR: RegExp = /"(?:c|\\u0063)(?:o|\\u006[Ff])(?:n|\\u006[Ee])(?:s|\\u0073)(?:t|\\u0074)(?:r|\\u0072)(?:u|\\u0075)(?:c|\\u0063)(?:t|\\u0074)(?:o|\\u006[Ff])(?:r|\\u0072)"\s*:/

/**
 * Remove the "__proto__" properties of a parsed log, false if it has a constructor with a prototype (not printed as a log)
 * @param log
 */
function Sanitize(log: object): boolean {
    let next: any[] = [log]
    try {
        while (next.length) {
            const nodes: any[] = next
            next = []
            for (const node of nodes) {
                if (hasOwn(node, '__proto__')) delete node.__proto__
                if (hasOwn(node, 'constructor') && Object.prototype.hasOwnProperty.call(node.constructor, 'prototype')) return false
                for (const key in node) {
                    const value: unknown = node[key]
                    if (value && typeof value === 'object') next.push(value)
                }
            }
        }
    } catch {
        return false
    }
    return true
}

/**
 * Indent the lines after the first one
 * @param input
 * @param ident
 */
function JoinLines(input: string, ident: string = IDENT): string {
    const lines: string[] = input.split(/\r?\n/)
    for (let index: number = 1; index < lines.length; index++) lines[index] = ident + lines[index]
    return lines.join(EOL)
}

/**
 * Whether a value is a plain object
 * @param value
 */
function IsObject(value: unknown): boolean {
    return Object.prototype.toString.call(value) === '[object Object]'
}

/**
 * Pad a number with zeros
 * @param value
 * @param length
 */
function Pad(value: number, length: number = 2): string {
    return String(value).padStart(length, '0')
}

/**
 * The time of a log, HH:MM:ss.SSS in the local time zone
 * @param log
 */
function PrettyTime(log: Record<string, any>): string | undefined {
    let time: any = null
    if ('time' in log) {
        time = log.time
    } else if ('timestamp' in log) {
        time = log.timestamp
    }
    if (time === null) return undefined
    let date: Date = new Date(time)
    if (isNaN(date.getTime())) date = new Date(+time)
    if (isNaN(date.getTime())) return `[${time}]`
    return `[${Pad(date.getHours())}:${Pad(date.getMinutes())}:${Pad(date.getSeconds())}.${Pad(date.getMilliseconds(), 3)}]`
}

/**
 * The label of the level of a log
 * @param log
 * @param palette
 */
function PrettyLevel(log: Record<string, any>, palette: Palette): string | undefined {
    if (!hasOwn(log, 'level')) return undefined
    const level: any = log.level
    if (level === undefined) return undefined
    let levelNumber: string | number = 'default'
    if (Number.isInteger(+level)) {
        levelNumber = hasOwn(LEVEL_LABELS, level) ? level : levelNumber
    } else {
        const name: string = String(level).toLowerCase()
        levelNumber = hasOwn(LEVEL_NUMBERS, name) ? LEVEL_NUMBERS[name] : levelNumber
    }
    const label: string = LEVEL_LABELS[levelNumber]
    return hasOwn(palette.level, levelNumber) ? palette.level[levelNumber](label) : palette.level.default(label)
}

/**
 * The metadata of a log: (name/pid on hostname) <caller>
 * @param log
 */
function PrettyMetadata(log: Record<string, any>): string | undefined {
    let line: string = ''
    if (log.name || log.pid || log.hostname) {
        line += '('
        if (log.name) line += log.name
        if (log.pid) line += log.name ? `/${log.pid}` : log.pid
        if (log.hostname) line += `${line === '(' ? 'on' : ' on'} ${log.hostname}`
        line += ')'
    }
    if (log.caller) line += `${line === '' ? '' : ' '}<${log.caller}>`
    return line === '' ? undefined : line
}

/**
 * An error property, its stack is written on its own lines
 * @param key
 * @param lines
 */
function PrettyError(key: string, lines: string): string {
    let result: string = ''
    const splitLines: string[] = `${IDENT}${key}: ${JoinLines(lines)}${EOL}`.split(EOL)
    for (let index: number = 0; index < splitLines.length; index++) {
        if (index) result += EOL
        const line: string = splitLines[index]
        const matches: RegExpExecArray | null = /^\s*"stack"/.test(line) ? /^(\s*"stack":)\s*(".*"),?$/.exec(line) : null
        if (matches) {
            const indentation: string = ' '.repeat(/^\s*/.exec(line)![0].length + 4)
            result += matches[1] + EOL + indentation + JSON.parse(matches[2]).replace(/\n/g, EOL + indentation)
        } else {
            result += line
        }
    }
    return result
}

/**
 * The properties of a log, one per line
 * @param log
 * @param palette
 * @param skipKeys
 * @param excludeLoggerKeys
 * @param ident
 */
function PrettyObject(log: Record<string, any>, palette: Palette, skipKeys: string[], excludeLoggerKeys: boolean = true, ident: string = IDENT): string {
    let result: string = ''
    let errors: [string, unknown][] | undefined
    for (const key in log) {
        if (!hasOwn(log, key) || skipKeys.includes(key) || (excludeLoggerKeys && LOGGER_KEYS.includes(key))) continue
        const value: unknown = log[key]
        if (ERROR_KEYS.has(key)) {
            (errors ??= []).push([key, value])
            continue
        }
        let lines: string | undefined = PropertyJSON(value)
        if (lines === undefined) continue
        if (lines.includes('\\\\')) lines = lines.replace(/\\\\/gi, '\\')
        const joinedLines: string = lines.includes('\n') ? JoinLines(lines, ident) : lines
        result += `${ident}${palette.property(key)}:${joinedLines.startsWith(EOL) ? '' : ' '}${joinedLines}${EOL}`
    }
    if (!errors) return result
    for (const [key, value] of errors) {
        const lines: string | undefined = JSON.stringify(value, null, 2)
        if (lines !== undefined) result += PrettyError(key, lines)
    }
    return result
}

/**
 * A log which is an error: its stack
 * @param log
 * @param palette
 */
function PrettyErrorLog(log: Record<string, any>, palette: Palette): string {
    let result: string = `${IDENT}${JoinLines(log.stack)}${EOL}`
    //The error properties to print: none
    if ('' in log) {
        result += IsObject(log['']) ? `${IDENT}: {${EOL}${PrettyObject(log[''], palette, [], false, IDENT + IDENT)}${IDENT}}${EOL}` : `${IDENT}: ${log['']}${EOL}`
    }
    return result
}

/**
 * Format a JSON log line for humans:
 * [time] LEVEL (name/pid): message, then the properties on their own lines
 * @param line the JSON log line, without its line terminator
 * @param palette
 * @param parsed the parsed line, if it is known (the log is changed)
 */
export function Pretty(line: string, palette: Palette, parsed?: Record<string, unknown>): string {
    let log: Record<string, any>
    if (parsed) {
        log = parsed
    } else {
        try {
            log = JSON.parse(line)
        } catch {
            return line + EOL
        }
        if (!IsObject(log)) return line + EOL
    }
    if ((SUSPECT_PROTO.test(line) || SUSPECT_CONSTRUCTOR.test(line)) && !Sanitize(log)) return line + EOL
    const message: string | undefined = 'msg' in log && (typeof log.msg === 'string' || typeof log.msg === 'number' || typeof log.msg === 'boolean') ? palette.message(log.msg) : undefined
    //The host name is not printed
    if (hasOwn(log, 'hostname')) delete log.hostname
    const level: string | undefined = PrettyLevel(log, palette)
    const metadata: string | undefined = PrettyMetadata(log)
    const time: string | undefined = PrettyTime(log)
    let result: string = time ?? ''
    if (level) result = result ? `${result} ${level}` : level
    if (metadata) result = result ? `${result} ${metadata}:` : metadata
    if (!result.endsWith(':') && result !== '') result += ':'
    if (message !== undefined) result = result ? `${result} ${message}` : message
    if (result.length) result += EOL
    if (log.type === 'Error' && typeof log.stack === 'string') return result + PrettyErrorLog(log, palette)
    const skipKeys: string[] = ['msg', 'level', 'time'].filter((key: string): boolean => typeof log[key] === 'string' || typeof log[key] === 'number' || typeof log[key] === 'boolean')
    return result + PrettyObject(log, palette, skipKeys)
}
