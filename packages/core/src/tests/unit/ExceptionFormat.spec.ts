import {describe, it} from 'node:test'
import assert from 'node:assert'
import {format} from 'node:util'
import {Exception} from '../../lib/foundation/Exception.js'

class TestException extends Exception {
    public errno: string = 'E_TEST'
}

/**
 * A pseudo random generator with a seed (mulberry32)
 * @param seed
 */
function seededRandom(seed: number): () => number {
    return (): number => {
        seed = (seed + 0x6D2B79F5) | 0
        let t: number = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const random: () => number = seededRandom(20261002)

const pick = <T>(values: T[]): T => values[Math.floor(random() * values.length)]

const PLACEHOLDERS: string[] = ['%s', '%d', '%i', '%f', '%j', '%o', '%O', '%c']

/**
 * A random argument of any type
 */
function argument(): unknown {
    const circular: Record<string, unknown> = {a: 1}
    circular.self = circular
    return pick([
        'text', '', '12px', '3.7', ' 5 ', 42, -0, 1.5, NaN, Infinity, 10n, Symbol('s'), null, undefined, true,
        {a: 1, b: [1, 2]}, [1, 'x'], circular, new Error('e'), new Date(0), (): number => 1, new Map([[1, 2]]), Object.create(null)
    ])
}

describe('The messages of the exceptions', (): void => {

    it('format the placeholders as util.format() of Node.js', (): void => {
        for (let run: number = 0; run < 5000; run++) {
            //Placeholders, text, %% and % alone (no braces: the templates of the data are not used)
            const tokens: string[] = Array.from({length: Math.floor(random() * 8)}, (): string => pick([...PLACEHOLDERS, 'a', ' ', 'x y', '100', '%%', '% off', '%x', '%5d']))
            const template: string = tokens.join('') + pick(['', '%', ' end'])
            const consuming: number = (template.match(/%[sdifjoOc%x]/g) ?? []).filter((match: string): boolean => PLACEHOLDERS.includes(match)).length
            //No argument more than the placeholders: util.format() would append it
            const args: unknown[] = Array.from({length: 1 + Math.floor(random() * Math.max(consuming, 1))}, argument).slice(0, Math.max(consuming, 1))
            if (consuming === 0 && args.length) continue
            let expected: string
            try {
                expected = format(template, ...args)
            } catch {
                //util.format() throws for an argument it cannot format (%j of a bigint, %d of an object without prototype):
                //the exception is created, the placeholder kept
                assert.strictEqual(typeof new TestException(template, ...args).message, 'string')
                continue
            }
            assert.strictEqual(new TestException(template, ...args).message, expected, JSON.stringify(template))
        }
    })

    it('keep the % alone, the unknown placeholders and the placeholders without argument', (): void => {
        assert.strictEqual(new TestException('100% done %s', 'now').message, '100% done now')
        assert.strictEqual(new TestException('50% off %s and %s', 'a').message, '50% off a and %s')
        assert.strictEqual(new TestException('%x %s', 'a').message, '%x a')
        assert.strictEqual(new TestException('%d', '12px').message, 'NaN')
        assert.strictEqual(new TestException('%i %f', '12px', '1.5x').message, '12 1.5')
        assert.strictEqual(new TestException('%o', [1]).message, format('%o', [1]))
        //The arguments are the data of the templates too: they are not appended
        assert.strictEqual(new TestException('{0} %s', 'a', 'b').message, 'a a')
        assert.strictEqual(new TestException('{name} failed', {name: 'job'}).message, 'job failed')
        //A single parameter given alone fills {0} too
        assert.strictEqual(new TestException('Order {0} not found', 7).message, 'Order 7 not found')
        assert.strictEqual(new TestException('Subject {0} forbidden', 'a.b').message, 'Subject a.b forbidden')
        assert.strictEqual(new TestException('Order {0} not found', [7]).message, 'Order 7 not found')
        //A template of the data missing is kept
        assert.strictEqual(new TestException('{0} {2}', 'a', 'b').message, 'a {2}')
        //An argument which cannot be formatted keeps its placeholder
        assert.strictEqual(new TestException('%j and %s', 5n, 'x').message, '%j and x')
        assert.strictEqual(new TestException('%x% off%%%d%d', Object.create(null), '12px').message, '%x% off%%dNaN')
    })

    it('keep errMsg the same as the message, the one a subclass sets in a field too', (): void => {
        class FieldException extends Exception {
            public errno: string = 'E_FIELD'

            public message: string = 'Set by a field'
        }

        const field: FieldException = new FieldException()
        assert.strictEqual(field.message, 'Set by a field')
        assert.strictEqual(field.errMsg, 'Set by a field')
        assert.strictEqual(field.stack?.split('\n')[0], 'FieldException: Set by a field')
        //errMsg stays a data property, and both are serialized
        assert.ok('value' in Object.getOwnPropertyDescriptor(field, 'errMsg')!)
        assert.deepStrictEqual([JSON.parse(JSON.stringify(field)).message, JSON.parse(JSON.stringify(field)).errMsg], ['Set by a field', 'Set by a field'])
        const changed: TestException = new TestException('First')
        changed.message = 'Second'
        assert.strictEqual(changed.errMsg, 'Second')
    })

    it('make the message of an exception built without arguments from the words of its class name', (): void => {
        class OrderNotFoundException extends Exception {
            public errno: string = 'E_ORDER_NOT_FOUND'
        }

        class HTTPRequestException extends Exception {
            public errno: string = 'E_HTTP_REQUEST'
        }

        class Http2StreamError extends Exception {
            public errno: string = 'E_HTTP2_STREAM'
        }

        assert.strictEqual(new OrderNotFoundException().message, 'Order not found exception')
        assert.strictEqual(new OrderNotFoundException().errMsg, 'Order not found exception')
        assert.strictEqual(new HTTPRequestException().message, 'HTTP request exception')
        assert.strictEqual(new Http2StreamError().message, 'Http2 stream error')
        assert.strictEqual(new TestException().message, 'Test exception')
    })
})
