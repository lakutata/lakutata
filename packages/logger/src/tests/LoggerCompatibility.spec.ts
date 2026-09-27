import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Writable} from 'node:stream'
import {pino, Logger as PinoLogger} from 'pino'
import {prettyFactory} from 'pino-pretty'
import {Bindings, BuildRecord} from '../lib/Record.js'
import {Pretty} from '../lib/Pretty.js'
import {COLOR_PALETTE, PLAIN_PALETTE} from '../lib/Colors.js'

//The logger of 2.x (pino + pino-pretty) is the reference of the log format
const NAME: string = 'Compat'

const LEVELS: [string, number][] = [['trace', 10], ['debug', 20], ['info', 30], ['warn', 40], ['error', 50]]

let written: string = ''

const reference: PinoLogger = pino({level: 'trace', name: NAME}, new Writable({
    write(chunk: Buffer, encoding: BufferEncoding, callback: () => void): void {
        written += chunk.toString()
        callback()
    }
}))

const FAILURES_OF_2X: string[] = ['serializers[key] is not a function', 'Cannot convert undefined or null to object']

const prettyColored: (line: string) => string = prettyFactory({colorize: true})

const prettyPlain: (line: string) => string = prettyFactory({colorize: false})

/**
 * The JSON line of the reference logger
 * @param level
 * @param args
 */
function ReferenceRecord(level: string, args: unknown[]): string {
    written = '';
    (reference as any)[level](...args)
    return written
}

/**
 * Hide the times, which differ between the loggers
 * @param text
 */
function WithoutTime(text: string): string {
    return text.replace(/"time":\d+/, '"time":0').replace(/^\[\d\d:\d\d:\d\d\.\d\d\d]/, '[time]')
}

/**
 * Whether a text is valid JSON
 * @param text
 */
function IsJSON(text: string): boolean {
    try {
        JSON.parse(text)
        return true
    } catch {
        return false
    }
}

/**
 * Compare the outputs of both loggers
 * @param args
 * @param label
 */
function Compare(args: unknown[], label: string): void {
    for (const [level, levelNumber] of LEVELS) {
        //The arguments are built twice, the loggers may change them (serializing an error tags it)
        let expected: string
        try {
            expected = ReferenceRecord(level, args)
        } catch (e) {
            let error: Error | undefined
            try {
                BuildRecord(levelNumber, Bindings(NAME), args)
            } catch (actualError) {
                error = actualError as Error
            }
            //The logs the reference cannot write (a symbol for %d) fail in the same way,
            //except the properties named like the members of Object.prototype, on which 2.x fails
            if (error) {
                assert.strictEqual(error.message, (e as Error).message, `throws ${label}`)
            } else {
                assert.ok(FAILURES_OF_2X.includes((e as Error).message), `does not throw ${label}: ${(e as Error).message}`)
            }
            continue
        }
        const actual: string = BuildRecord(levelNumber, Bindings(NAME), args).line
        if (!IsJSON(expected)) {
            //2.x writes invalid lines for the properties named like the members of Object.prototype, the logger does not
            assert.ok(IsJSON(actual), `valid JSON ${label}`)
            continue
        }
        assert.strictEqual(WithoutTime(actual), WithoutTime(expected), `JSON ${label}`)
        const line: string = expected.slice(0, -1)
        let colored: string
        try {
            colored = prettyColored(line)
        } catch {
            //The reference fails on some logs (a level which is not a number or a string), the logger does not
            assert.strictEqual(typeof Pretty(line, COLOR_PALETTE), 'string')
            continue
        }
        assert.strictEqual(Pretty(line, COLOR_PALETTE), colored, `colored ${label}`)
        //The parsed line built with the JSON line gives the same output
        const parsed: Record<string, unknown> | undefined = BuildRecord(levelNumber, Bindings(NAME), args, true).log
        if (parsed) {
            parsed.time = JSON.parse(line).time
            assert.strictEqual(Pretty(line, COLOR_PALETTE, parsed), colored, `parsed ${label}`)
        }
        assert.strictEqual(Pretty(line, PLAIN_PALETTE), prettyPlain(line), `plain ${label}`)
    }
}

//Deterministic pseudo random numbers (mulberry32)
function Random(seed: number): () => number {
    return (): number => {
        seed = (seed + 0x6D2B79F5) | 0
        let t: number = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

describe('Logger compatibility with 2.x', (): void => {

    it('formats the messages', (): void => {
        const cases: unknown[][] = [
            [],
            ['plain message'],
            [''],
            ['with %s and %d and %i and %f', 'text', '42.5', 7.9, '1.5'],
            ['%o %O %j', {a: 1}, 'str', (): void => undefined],
            ['missing %s %s', 'one'],
            ['extra', 'argument', {ignored: true}],
            ['percent %% and %s', 'value'],
            ['%d with null', null],
            ['%j circular', ((): object => {
                const circular: Record<string, unknown> = {a: 1}
                circular.self = circular
                return circular
            })()],
            ['quote " backslash \\ tab \t newline \n end'],
            ['unicode 中文 😀 \u2028'],
            ['close \x1b[39m inside \x1b[39m twice'],
            ['a'.repeat(150)],
            [42],
            [true],
            [null],
            [undefined, 'after undefined %s', 'x'],
            [Symbol('s')],
            [(): void => undefined],
            [123n]
        ]
        cases.forEach((args: unknown[], index: number): void => Compare(args, `message ${index}`))
    })

    it('formats the objects', (): void => {
        const typed: Uint8Array = new Uint8Array([1, 2, 3])
        const circular: Record<string, unknown> = {typed: typed, list: [1, 2]}
        circular.self = circular
        const wide: Record<string, unknown> = {circular: circular}
        for (let index: number = 0; index < 150; index++) wide[`k${index}`] = index
        const deep: Record<string, unknown> = {level1: {level2: {level3: {level4: {level5: {level6: {level7: 1}}}}}}}
        deep.circular = deep
        const cases: unknown[][] = [
            [{id: 1, user: 'alice'}, 'request %s done', 'GET /x'],
            [{id: 1, user: 'alice'}],
            [{nested: {list: [1, 'two', null, {three: 3}], empty: {}, emptyList: []}}, 'nested'],
            [{date: new Date(0), buffer: Buffer.from('ab'), nan: NaN, infinity: -Infinity, big: 12345678901234567890n}],
            [{undef: undefined, fn: (): void => undefined, symbol: Symbol('x'), kept: 1}],
            [{path: 'C:\\dir\\file', quote: '"quoted"'}, 'paths'],
            [{multiline: 'first\nsecond'}],
            [{msg: 'message in the object'}],
            [{msg: 'object message'}, 'argument message'],
            [{msg: {nested: true}}],
            [{level: 'custom', time: 'yesterday', name: 'other', pid: 0, hostname: 'host', caller: 'fn'}, 'keys of the logger'],
            [{level: 70}, 'user level'],
            [{level: 'WARN'}, 'named level'],
            [{timestamp: 1}],
            [{type: 'Error', stack: 'Error: top\n    at somewhere', message: 'top'}],
            [{type: 'Error', stack: 'Error: top', '': {a: 1}}],
            [{'': 'empty key'}],
            [JSON.parse('{"__proto__": {"polluted": true}, "kept": 1}'), 'prototype key'],
            [{nested: JSON.parse('{"__proto__": 1, "a": 2}')}],
            [{constructor: {prototype: {}}}, 'constructor'],
            [{constructor: null}, 'null constructor'],
            [{constructor: 'text'}, 'text constructor'],
            [{toString: 'text', valueOf: 1}, 'members of Object.prototype'],
            [{err: 'not an error'}],
            [{err: {message: 'error like', code: 'E'}}],
            [{error: new Error('under error')}],
            [{a: 1}, {b: 2}, {c: 3}],
            [{a: 1}, null],
            [null, 'after null'],
            [['array', 'as', 'object'], 'array'],
            [wide, 'circular and wide'],
            [deep, 'circular and deep'],
            [{method: 'GET', headers: {host: 'h'}, socket: {remoteAddress: '::1', remotePort: 1}, url: '/path', id: 7, query: {q: 1}}, 'request'],
            [{method: 'GET', headers: {}, socket: {}, originalUrl: '/original', info: {id: 'i', remoteAddress: 'r'}}],
            [{setHeader: (): void => undefined, headersSent: true, statusCode: 200, getHeaders: (): object => ({a: 'b'})}, 'response']
        ]
        cases.forEach((args: unknown[], index: number): void => Compare(args, `object ${index}`))
    })

    it('formats the errors', (): void => {
        const cause: Error = new Error('the cause')
        const withCause: Error = new Error('with cause', {cause: cause})
        const custom: Error = Object.assign(new TypeError('custom'), {code: 'E_CUSTOM', details: {a: [1]}, raw: 'raw', inner: new RangeError('inner')})
        const aggregate: AggregateError = new AggregateError([new Error('first'), 'second'], 'aggregate')
        const circularCause: Error = new Error('circular')
        circularCause.cause = circularCause
        const functionCause: Error = new Error('function cause')
        Reflect.set(functionCause, 'cause', (): Error => cause)
        class NamedError extends Error {
            public name: string = 'Renamed'
        }
        const cases: unknown[][] = [
            [new Error('plain error')],
            [new Error('with message'), 'the message'],
            [new Error('with format'), 'code %d', 5],
            [withCause],
            [custom],
            [aggregate],
            [circularCause],
            [functionCause],
            [new NamedError('named')],
            [Object.assign(new Error(''), {stack: undefined})],
            [{err: withCause, other: 1}, 'err key'],
            [{err: new Error('err key without message')}]
        ]
        cases.forEach((args: unknown[], index: number): void => Compare(args, `error ${index}`))
    })

    it('formats random logs like 2.x', (): void => {
        const random: () => number = Random(20260928)
        const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)]
        const keys: string[] = ['id', 'user', 'msg', 'err', 'error', 'data', 'list', 'level', 'name', 'x y', 'ünï', '0', 'type', 'stack']
        const value = (depth: number): unknown => {
            switch (Math.floor(random() * (depth > 2 ? 6 : 9))) {
                case 0:
                    return pick(['', 'text', ':colon', 'a\\b', 'line\nbreak', '中文', '%s', '\x1b[39m'])
                case 1:
                    return pick([0, -1, 1.5, 1e21, NaN, 2 ** 53])
                case 2:
                    return pick([true, false, null, undefined])
                case 3:
                    return new Error(pick(['boom', '', 'with\nlines']))
                case 4:
                    return new Date(pick([0, 1e12]))
                case 5:
                    return pick([Buffer.from('x'), 5n, Symbol('s')])
                case 6:
                case 7: {
                    const object: Record<string, unknown> = {}
                    const count: number = Math.floor(random() * 4)
                    for (let index: number = 0; index < count; index++) object[pick(keys)] = value(depth + 1)
                    return object
                }
                default:
                    return Array.from({length: Math.floor(random() * 3)}, (): unknown => value(depth + 1))
            }
        }
        for (let index: number = 0; index < 5000; index++) {
            const args: unknown[] = []
            if (random() < 0.6) args.push(value(0))
            if (random() < 0.7) args.push(pick(['message', 'with %s', '%d items', '%j', '%o and %s', '%%']))
            const extra: number = Math.floor(random() * 3)
            for (let item: number = 0; item < extra; item++) args.push(value(1))
            Compare(args, `random ${index}`)
        }
    })
})
