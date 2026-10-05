import {describe, it} from 'node:test'
import assert from 'node:assert'
import {setTimeout as sleep} from 'node:timers/promises'
import {runInNewContext} from 'node:vm'
import {isAbortError, isEmptyObject, isHTML, isNativeFunction, isPath, isPromise, isPromiseLike} from '../exports/Utils.js'

describe('Guards', (): void => {

    it('recognizes the abort errors of Node.js and the DOMException AbortError', async (): Promise<void> => {
        const controller: AbortController = new AbortController()
        controller.abort()
        assert.strictEqual(isAbortError(controller.signal.reason), true)
        assert.strictEqual(isAbortError(new DOMException('aborted', 'AbortError')), true)
        await assert.rejects(sleep(1000, undefined, {signal: AbortSignal.timeout(5)}), (error: unknown): boolean => isAbortError(error))
        const timeout: AbortSignal = AbortSignal.timeout(1)
        await sleep(20)
        //The reason of a timeout is a TimeoutError
        assert.strictEqual(isAbortError(timeout.reason), false)
        assert.strictEqual(isAbortError({code: 'ABORT_ERR'}), true)
        for (const value of [undefined, null, 0, '', new Error('x'), {}]) assert.strictEqual(isAbortError(value), false, String(value))
    })

    it('tells the empty objects, maps and sets', (): void => {
        assert.strictEqual(isEmptyObject({}), true)
        assert.strictEqual(isEmptyObject(Object.create(null)), true)
        assert.strictEqual(isEmptyObject({a: 1}), false)
        assert.strictEqual(isEmptyObject({[Symbol('id')]: 1}), false)
        assert.strictEqual(isEmptyObject([]), false)
        assert.strictEqual(isEmptyObject(null), true)
        assert.strictEqual(isEmptyObject(undefined), true)
        assert.strictEqual(isEmptyObject(new Map()), true)
        assert.strictEqual(isEmptyObject(new Map([['a', 1]])), false)
        assert.strictEqual(isEmptyObject(new Set()), true)
        assert.strictEqual(isEmptyObject(new Set([1])), false)
        for (const primitive of [1, 0, true, '', 'a', 10n, Symbol('s')]) assert.strictEqual(isEmptyObject(primitive), false, String(primitive))
    })

    it('tells HTML from the values which are not strings', (): void => {
        assert.strictEqual(isHTML('<p>Hello</p>'), true)
        for (const value of [undefined, null, 5, {}] as any[]) assert.strictEqual(isHTML(value), false)
    })

    it('tells the promises from the thenables', (): void => {
        const thenable: { then: () => void } = {then: (): void => undefined}
        const callable: (() => void) & { then?: () => void } = (): void => undefined
        callable.then = (): void => undefined
        class Subclass<T> extends Promise<T> {
        }
        const foreign: unknown = runInNewContext('Promise.resolve(1)')
        assert.deepStrictEqual([isPromise(Promise.resolve(1)), isPromise(Subclass.resolve(1)), isPromise(foreign)], [true, true, true])
        assert.deepStrictEqual([isPromise(thenable), isPromise(callable), isPromise(null), isPromise(1)], [false, false, false, false])
        assert.deepStrictEqual([isPromiseLike(Promise.resolve(1)), isPromiseLike(thenable), isPromiseLike(callable), isPromiseLike(foreign)], [true, true, true, true])
        assert.deepStrictEqual([isPromiseLike(null), isPromiseLike(undefined), isPromiseLike({then: 1}), isPromiseLike('then')], [false, false, false, false])
    })

    it('keeps the documented edge cases of isPath and isNativeFunction', (): void => {
        assert.strictEqual(isPath(Buffer.from('/var/log')), true)
        assert.strictEqual(isNativeFunction((function named(): void {
        }).bind(null)), true)
    })
})
