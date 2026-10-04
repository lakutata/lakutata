import {describe, it} from 'node:test'
import assert from 'node:assert'
import {setTimeout as sleep} from 'node:timers/promises'
import {runInNewContext} from 'node:vm'
import {IsAbortError, IsEmptyObject, IsHTML, IsNativeFunction, IsPath, IsPromise, IsPromiseLike} from '../exports/Utils.js'

describe('Guards', (): void => {

    it('recognizes the abort errors of Node.js and the DOMException AbortError', async (): Promise<void> => {
        const controller: AbortController = new AbortController()
        controller.abort()
        assert.strictEqual(IsAbortError(controller.signal.reason), true)
        assert.strictEqual(IsAbortError(new DOMException('aborted', 'AbortError')), true)
        await assert.rejects(sleep(1000, undefined, {signal: AbortSignal.timeout(5)}), (error: unknown): boolean => IsAbortError(error))
        const timeout: AbortSignal = AbortSignal.timeout(1)
        await sleep(20)
        //The reason of a timeout is a TimeoutError
        assert.strictEqual(IsAbortError(timeout.reason), false)
        assert.strictEqual(IsAbortError({code: 'ABORT_ERR'}), true)
        for (const value of [undefined, null, 0, '', new Error('x'), {}]) assert.strictEqual(IsAbortError(value), false, String(value))
    })

    it('tells the empty objects, maps and sets', (): void => {
        assert.strictEqual(IsEmptyObject({}), true)
        assert.strictEqual(IsEmptyObject(Object.create(null)), true)
        assert.strictEqual(IsEmptyObject({a: 1}), false)
        assert.strictEqual(IsEmptyObject({[Symbol('id')]: 1}), false)
        assert.strictEqual(IsEmptyObject([]), false)
        assert.strictEqual(IsEmptyObject(null), true)
        assert.strictEqual(IsEmptyObject(undefined), true)
        assert.strictEqual(IsEmptyObject(new Map()), true)
        assert.strictEqual(IsEmptyObject(new Map([['a', 1]])), false)
        assert.strictEqual(IsEmptyObject(new Set()), true)
        assert.strictEqual(IsEmptyObject(new Set([1])), false)
        for (const primitive of [1, 0, true, '', 'a', 10n, Symbol('s')]) assert.strictEqual(IsEmptyObject(primitive), false, String(primitive))
    })

    it('tells HTML from the values which are not strings', (): void => {
        assert.strictEqual(IsHTML('<p>Hello</p>'), true)
        for (const value of [undefined, null, 5, {}] as any[]) assert.strictEqual(IsHTML(value), false)
    })

    it('tells the promises from the thenables', (): void => {
        const thenable: { then: () => void } = {then: (): void => undefined}
        const callable: (() => void) & { then?: () => void } = (): void => undefined
        callable.then = (): void => undefined
        class Subclass<T> extends Promise<T> {
        }
        const foreign: unknown = runInNewContext('Promise.resolve(1)')
        assert.deepStrictEqual([IsPromise(Promise.resolve(1)), IsPromise(Subclass.resolve(1)), IsPromise(foreign)], [true, true, true])
        assert.deepStrictEqual([IsPromise(thenable), IsPromise(callable), IsPromise(null), IsPromise(1)], [false, false, false, false])
        assert.deepStrictEqual([IsPromiseLike(Promise.resolve(1)), IsPromiseLike(thenable), IsPromiseLike(callable), IsPromiseLike(foreign)], [true, true, true, true])
        assert.deepStrictEqual([IsPromiseLike(null), IsPromiseLike(undefined), IsPromiseLike({then: 1}), IsPromiseLike('then')], [false, false, false, false])
    })

    it('keeps the documented edge cases of IsPath and IsNativeFunction', (): void => {
        assert.strictEqual(IsPath(Buffer.from('/var/log')), true)
        assert.strictEqual(IsNativeFunction((function named(): void {
        }).bind(null)), true)
    })
})
