/**
 * The part of the vitest API used by the protocol-engine suites (ported from werift), on node:test and node:assert: the
 * suites keep the form of their tests, only their imports differ. The fake timers are the clock of this module (the
 * mock.timers of node:test fakes neither the imports of node:timers/promises nor performance.now, and counts no timers)
 */
import {AssertionError} from 'node:assert'
import {createRequire, syncBuiltinESMExports} from 'node:module'
import {
    after,
    afterEach as nodeAfterEach,
    before,
    beforeEach as nodeBeforeEach,
    describe as nodeDescribe,
    it as nodeIt,
    type TestContext
} from 'node:test'
import {format, inspect} from 'node:util'

type Awaitable<T> = T | PromiseLike<T>

type Procedure = (...args: any[]) => any

//The performance.now of the process, kept before any test fakes it
const realPerformanceNow: PropertyDescriptor = Object.getOwnPropertyDescriptor(performance, 'now')
    ?? {value: performance.now.bind(performance), writable: true, configurable: true, enumerable: true}

//The timers of the process, kept before any test fakes them
const realTimers = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    setImmediate: globalThis.setImmediate,
    clearImmediate: globalThis.clearImmediate,
    Date: globalThis.Date
}

//The exports of node:timers/promises: syncBuiltinESMExports() carries their changes to the ES module imports
const timersPromises: {setTimeout: Procedure} = createRequire(import.meta.url)('node:timers/promises')
const realPromiseTimeout: Procedure = timersPromises.setTimeout

/* Runner */

/**
 * The context given to a test
 */
export interface VitestContext {
    /**
     * Ends the test as skipped
     * @param note
     */
    skip(note?: string): never

    signal: AbortSignal

    task: {name: string}
}

export type TestFunction = (context: VitestContext) => unknown

export interface TestOptions {
    timeout?: number
    skip?: boolean | string
}

type HookFunction = () => unknown

type EachFunction = (...args: any[]) => unknown

//Thrown by skip() of the context to end the test
class SkipSignal extends Error {
}

function nodeOptions(options: TestOptions): {timeout?: number, skip?: boolean | string} {
    const result: {timeout?: number, skip?: boolean | string} = {}
    if (options.timeout !== undefined) result.timeout = options.timeout
    if (options.skip) result.skip = options.skip
    return result
}

/**
 * The arguments of test(name, fn, timeout), test(name, fn, options) and test(name, options, fn)
 * @param second
 * @param third
 */
function testArguments(second: unknown, third: unknown): {options: TestOptions, fn?: TestFunction} {
    if (typeof second === 'function') {
        if (typeof third === 'number') return {options: {timeout: third}, fn: second as TestFunction}
        return {options: (third ?? {}) as TestOptions, fn: second as TestFunction}
    }
    if (typeof second === 'number') return {options: {timeout: second}, fn: third as TestFunction | undefined}
    return {options: (second ?? {}) as TestOptions, fn: third as TestFunction | undefined}
}

/**
 * The hooks of each test declared at the top of a file (outside of a describe), run around the tests by runnable(): the
 * test runner of Node.js 18.10 does not run the hooks of the top of a file
 */
const fileBeforeEach: HookFunction[] = []
const fileAfterEach: HookFunction[] = []

//How deep the suite being defined is: 0 at the top of a file
let suiteDepth: number = 0

function runnable(fn: TestFunction, name: string): (...args: [TestContext?]) => Promise<void> {
    //Declaring no parameter: the runner of Bun waits for the callback of a test that declares one
    return async (...args: [TestContext?]): Promise<void> => {
        for (const hookOfFile of fileBeforeEach) await hookOfFile()
        try {
            await runTest(fn, name, args[0])
        } finally {
            for (const hookOfFile of fileAfterEach) await hookOfFile()
        }
    }
}

/**
 * Run the function of a test with its vitest context
 */
async function runTest(fn: TestFunction, name: string, t: TestContext | undefined): Promise<void> {
    const context: VitestContext = {
        skip: (note?: string): never => {
            t?.skip(note)
            throw new SkipSignal(note)
        },
        signal: t?.signal ?? new AbortController().signal,
        task: {name: t?.name ?? name}
    }
    try {
        await fn(context)
    } catch (error) {
        if (!(error instanceof SkipSignal)) throw error
    }
}

//The skip options of the skipped suites being defined: their tests are skipped (vitest lists them), their hooks left out
const skippedSuites: Array<boolean | string> = []

function defineTest(name: string, second: unknown, third: unknown, extra: TestOptions = {}): void {
    const {options, fn} = testArguments(second, third)
    const merged: TestOptions = {...options, ...extra, ...(skippedSuites.length ? {skip: skippedSuites[skippedSuites.length - 1]} : {})}
    if (!fn) {
        void nodeIt(name, {todo: true})
        return
    }
    void nodeIt(name, nodeOptions(merged), runnable(fn, name))
}

function defineSuite(name: string, second: unknown, third: unknown, extra: TestOptions = {}): void {
    const fn: (() => void) | undefined = typeof second === 'function' ? second as () => void : third as (() => void) | undefined
    const options: TestOptions = typeof second === 'object' && second !== null ? second as TestOptions : {}
    const skip: boolean | string | undefined = extra.skip ?? options.skip
    void nodeDescribe(name, (): void => {
        if (skip) skippedSuites.push(skip)
        suiteDepth++
        try {
            fn?.()
        } finally {
            suiteDepth--
            if (skip) skippedSuites.pop()
        }
    })
}

/**
 * The title of a case of each(): the printf placeholders take the arguments in turn (%# the index, %$ the number), $key
 * the properties of an object case
 * @param template
 * @param args
 * @param index
 */
function eachTitle(template: string, args: unknown[], index: number): string {
    let next: number = 0
    let title: string = template.replace(/%([sdifjoO#$%])/g, (match: string, type: string): string => {
        if (type === '%') return '%'
        if (type === '#') return String(index)
        if (type === '$') return String(index + 1)
        if (next >= args.length) return match
        return format(`%${type}`, args[next++])
    })
    const row: unknown = args[0]
    if (args.length === 1 && typeof row === 'object' && row !== null && !Array.isArray(row)) {
        title = title.replace(/\$([A-Za-z_]\w*(?:\.\w+)*)/g, (match: string, path: string): string => {
            const keys: string[] = path.split('.')
            if (!(keys[0] in row)) return match
            const value: unknown = keys.reduce((object: any, key: string): unknown => object?.[key], row)
            return inspect(value, {breakLength: Infinity})
        })
    }
    return title
}

function each(table: readonly unknown[], define: (name: string, second: unknown, third: unknown) => void) {
    return (name: string, fn: EachFunction, options?: number | TestOptions): void => {
        table.forEach((row: unknown, index: number): void => {
            const args: unknown[] = Array.isArray(row) ? row : [row]
            define(eachTitle(name, args, index), (): unknown => fn(...args), options)
        })
    }
}

interface TestAPI {
    (name: string, fn?: TestFunction, options?: number | TestOptions): void

    (name: string, options: TestOptions, fn?: TestFunction): void

    skip(name: string, fn?: TestFunction, options?: number | TestOptions): void

    each(table: readonly unknown[]): (name: string, fn: EachFunction, options?: number | TestOptions) => void
}

interface SuiteAPI {
    (name: string, fn?: () => void): void

    (name: string, options: TestOptions, fn?: () => void): void

    skip(name: string, fn?: () => void): void

    each(table: readonly unknown[]): (name: string, fn: EachFunction) => void
}

function createTestAPI(): TestAPI {
    const api = ((name: string, second?: unknown, third?: unknown): void => defineTest(name, second, third)) as TestAPI
    api.skip = (name: string, second?: unknown, third?: unknown): void => defineTest(name, second, third, {skip: true})
    api.each = (table: readonly unknown[]) => each(table, (name: string, second: unknown, third: unknown): void => defineTest(name, second, third))
    return api
}

/**
 * Defines a test
 */
export const test: TestAPI = createTestAPI()

/**
 * Defines a test
 */
export const it: TestAPI = test

/**
 * Defines a suite of tests
 */
export const describe: SuiteAPI = Object.assign(
    (name: string, second?: unknown, third?: unknown): void => defineSuite(name, second, third),
    {
        skip: (name: string, fn?: () => void): void => defineSuite(name, fn, undefined, {skip: true}),
        each: (table: readonly unknown[]) => (name: string, fn: EachFunction): void => {
            table.forEach((row: unknown, index: number): void => {
                const args: unknown[] = Array.isArray(row) ? row : [row]
                defineSuite(eachTitle(name, args, index), (): unknown => fn(...args), undefined)
            })
        }
    }
) as SuiteAPI

function hook(fn: HookFunction): () => Promise<void> {
    return async (): Promise<void> => {
        await fn()
    }
}

export function beforeEach(fn: HookFunction, timeout?: number): void {
    if (!suiteDepth) fileBeforeEach.push(fn)
    else if (!skippedSuites.length) nodeBeforeEach(hook(fn), nodeOptions({timeout}))
}

export function afterEach(fn: HookFunction, timeout?: number): void {
    if (!suiteDepth) fileAfterEach.push(fn)
    else if (!skippedSuites.length) nodeAfterEach(hook(fn), nodeOptions({timeout}))
}

export function beforeAll(fn: HookFunction, timeout?: number): void {
    if (!skippedSuites.length) before(hook(fn), nodeOptions({timeout}))
}

export function afterAll(fn: HookFunction, timeout?: number): void {
    if (!skippedSuites.length) after(hook(fn), nodeOptions({timeout}))
}

/* Equality */

/**
 * A value matching others by a rule (expect.any() and the like)
 */
abstract class AsymmetricMatcher {
    public abstract asymmetricMatch(other: unknown): boolean

    public abstract toString(): string

    public [inspect.custom](): string {
        return this.toString()
    }
}

class Any extends AsymmetricMatcher {
    constructor(private readonly sample: unknown) {
        super()
    }

    public asymmetricMatch(other: unknown): boolean {
        switch (this.sample) {
            case String:
                return typeof other === 'string' || other instanceof String
            case Number:
                return typeof other === 'number' || other instanceof Number
            case Boolean:
                return typeof other === 'boolean' || other instanceof Boolean
            case BigInt:
                return typeof other === 'bigint'
            case Symbol:
                return typeof other === 'symbol'
            case Function:
                return typeof other === 'function'
            case Object:
                return typeof other === 'object' && other !== null
            default:
                return other instanceof (this.sample as Procedure)
        }
    }

    public toString(): string {
        return `Any<${(this.sample as {name?: string}).name ?? String(this.sample)}>`
    }
}

class Anything extends AsymmetricMatcher {
    public asymmetricMatch(other: unknown): boolean {
        return other !== null && other !== undefined
    }

    public toString(): string {
        return 'Anything'
    }
}

class ObjectContaining extends AsymmetricMatcher {
    constructor(private readonly sample: object) {
        super()
    }

    public asymmetricMatch(other: unknown): boolean {
        if (other === null || other === undefined) return false
        const object: Record<PropertyKey, unknown> = Object(other)
        return ownKeys(this.sample).every((key: PropertyKey): boolean => key in object && equals(object[key], (this.sample as Record<PropertyKey, unknown>)[key]))
    }

    public toString(): string {
        return `ObjectContaining ${inspect(this.sample, {breakLength: Infinity})}`
    }
}

function ownKeys(object: object): PropertyKey[] {
    return [
        ...Object.keys(object),
        ...Object.getOwnPropertySymbols(object).filter((symbol: symbol): boolean => Object.prototype.propertyIsEnumerable.call(object, symbol))
    ]
}

function bytesOf(view: ArrayBufferView | ArrayBufferLike): Buffer {
    return ArrayBuffer.isView(view) ? Buffer.from(view.buffer, view.byteOffset, view.byteLength) : Buffer.from(view)
}

/**
 * The equality of toEqual(): structural, the types of the objects not compared, the properties holding undefined ignored
 * @param a
 * @param b
 * @param seen
 */
function equals(a: unknown, b: unknown, seen: Array<[unknown, unknown]> = []): boolean {
    if (b instanceof AsymmetricMatcher) return b.asymmetricMatch(a)
    if (a instanceof AsymmetricMatcher) return a.asymmetricMatch(b)
    if (Object.is(a, b)) return true
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
    const tag: string = Object.prototype.toString.call(a)
    if (tag !== Object.prototype.toString.call(b)) return false
    if (seen.some(([x, y]: [unknown, unknown]): boolean => x === a && y === b)) return true
    seen = [...seen, [a, b]]
    if (a instanceof Date) return Object.is(a.getTime(), (b as Date).getTime())
    if (a instanceof RegExp) return String(a) === String(b)
    if (a instanceof Number || a instanceof String || a instanceof Boolean) return Object.is(a.valueOf(), (b as object).valueOf())
    if (ArrayBuffer.isView(a) || a instanceof ArrayBuffer) return bytesOf(a).equals(bytesOf(b as ArrayBufferView))
    if (a instanceof Error && (a.name !== (b as Error).name || a.message !== (b as Error).message)) return false
    if (a instanceof Map) {
        const other: Map<unknown, unknown> = b as Map<unknown, unknown>
        if (a.size !== other.size) return false
        for (const [key, value] of a) {
            const matched: boolean = other.has(key)
                ? equals(value, other.get(key), seen)
                : [...other].some(([otherKey, otherValue]: [unknown, unknown]): boolean => equals(key, otherKey, seen) && equals(value, otherValue, seen))
            if (!matched) return false
        }
        return true
    }
    if (a instanceof Set) {
        const other: Set<unknown> = b as Set<unknown>
        if (a.size !== other.size) return false
        for (const value of a) {
            if (!other.has(value) && ![...other].some((otherValue: unknown): boolean => equals(value, otherValue, seen))) return false
        }
        return true
    }
    if (Array.isArray(a) && a.length !== (b as unknown[]).length) return false
    const objectA: Record<PropertyKey, unknown> = a as Record<PropertyKey, unknown>
    const objectB: Record<PropertyKey, unknown> = b as Record<PropertyKey, unknown>
    const keysA: PropertyKey[] = ownKeys(objectA).filter((key: PropertyKey): boolean => objectA[key] !== undefined)
    const keysB: PropertyKey[] = ownKeys(objectB).filter((key: PropertyKey): boolean => objectB[key] !== undefined)
    if (keysA.length !== keysB.length) return false
    const keySetB: Set<PropertyKey> = new Set(keysB)
    return keysA.every((key: PropertyKey): boolean => keySetB.has(key) && equals(objectA[key], objectB[key], seen))
}

/**
 * The equality of toMatchObject(): the properties of the subset, recursively, the arrays of the same length
 * @param object
 * @param subset
 * @param seen
 */
function matchesSubset(object: unknown, subset: unknown, seen: Set<unknown> = new Set()): boolean {
    if (subset instanceof AsymmetricMatcher) return subset.asymmetricMatch(object)
    if (Array.isArray(subset)) {
        return Array.isArray(object) && object.length === subset.length && subset.every((item: unknown, index: number): boolean => matchesSubset(object[index], item, seen))
    }
    const structural: boolean = typeof subset === 'object' && subset !== null && !(subset instanceof Date || subset instanceof RegExp
        || subset instanceof Map || subset instanceof Set || ArrayBuffer.isView(subset) || subset instanceof ArrayBuffer)
    if (!structural) return equals(object, subset)
    if (object === null || (typeof object !== 'object' && typeof object !== 'function')) return false
    if (seen.has(subset)) return true
    seen.add(subset)
    const target: Record<PropertyKey, unknown> = object as Record<PropertyKey, unknown>
    return ownKeys(subset as object).every((key: PropertyKey): boolean => key in target && matchesSubset(target[key], (subset as Record<PropertyKey, unknown>)[key], seen))
}

/* Assertions */

function show(value: unknown): string {
    if (typeof value === 'function') return `[Function${value.name ? ` ${value.name}` : ''}]`
    return inspect(value, {depth: 4, breakLength: Infinity, maxArrayLength: 32, maxStringLength: 400})
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return typeof (value as {then?: unknown} | null | undefined)?.then === 'function'
}

function messageOf(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'message' in error) return String((error as Error).message)
    return String(error)
}

interface MatcherState {
    negated: boolean
    mode: 'sync' | 'resolves' | 'rejects'
    //The message given to expect(), before the one of a failure
    message?: string
}

interface MatchResult {
    pass: boolean
    //What the received value is expected to do, after "to" ("not to" when negated)
    message: string
    actual?: unknown
    expected?: unknown
}

type MatcherFunction = (state: MatcherState, received: any, ...expected: any[]) => MatchResult

function compare(received: unknown, expected: unknown, operator: string, check: (a: any, b: any) => boolean): MatchResult {
    const comparable = (value: unknown): boolean => typeof value === 'number' || typeof value === 'bigint'
    if (!comparable(received) || !comparable(expected)) throw new TypeError(`${show(received)} and ${show(expected)} must be numbers or bigints`)
    return {pass: check(received, expected), message: `be ${operator} ${show(expected)}`}
}

function mockOf(received: unknown): Mock {
    if (!isMock(received)) throw new TypeError(`${show(received)} is not a mock or a spy`)
    return received
}

function calledTimes(_state: MatcherState, received: unknown, times: number): MatchResult {
    const count: number = mockOf(received).mock.calls.length
    return {pass: count === times, message: `be called ${times} times, called ${count} times`}
}

//The error thrown by the received function, or the reason of the rejection
function thrownBy(state: MatcherState, received: unknown): {thrown: boolean, error?: unknown} {
    if (state.mode === 'rejects') return {thrown: true, error: received}
    if (typeof received !== 'function') throw new TypeError(`${show(received)} is not a function`)
    try {
        received()
    } catch (error) {
        return {thrown: true, error}
    }
    return {thrown: false}
}

function toThrow(state: MatcherState, received: unknown, expected?: unknown): MatchResult {
    const {thrown, error} = thrownBy(state, received)
    if (!thrown) return {pass: false, message: `throw${expected === undefined ? '' : ` ${show(expected)}`}, nothing was thrown`}
    const description: string = `throw${expected === undefined ? '' : ` ${show(expected)}`}, threw ${show(error)}`
    if (expected === undefined) return {pass: true, message: description}
    if (typeof expected === 'string') return {pass: messageOf(error).includes(expected), message: description}
    if (expected instanceof RegExp) return {pass: expected.test(messageOf(error)), message: description}
    if (expected instanceof AsymmetricMatcher) return {pass: expected.asymmetricMatch(error), message: description}
    if (typeof expected === 'function') return {pass: error instanceof expected, message: description}
    if (typeof expected === 'object' && expected !== null && 'message' in expected) return {pass: messageOf(error) === messageOf(expected), message: description}
    return {pass: equals(error, expected), message: description}
}

const matchers: Record<string, MatcherFunction> = {
    toBe: (_state, received, expected): MatchResult => ({
        pass: Object.is(received, expected),
        message: `be ${show(expected)}${!Object.is(received, expected) && equals(received, expected) ? ' (deeply equal, not the same value)' : ''}`,
        actual: received,
        expected
    }),
    toEqual: (_state, received, expected): MatchResult => ({pass: equals(received, expected), message: `equal ${show(expected)}`, actual: received, expected}),
    toMatchObject: (_state, received, expected): MatchResult => ({pass: matchesSubset(received, expected), message: `match the object ${show(expected)}`, actual: received, expected}),
    toHaveLength: (_state, received, length): MatchResult => ({
        pass: received !== null && received !== undefined && received.length === length,
        message: `have the length ${length}, has the length ${received?.length}`
    }),
    toContain: (_state, received, item): MatchResult => {
        let pass: boolean
        if (typeof received === 'string') pass = received.includes(item)
        else if (received !== null && received !== undefined && typeof received.includes === 'function') pass = received.includes(item)
        else if (received !== null && received !== undefined && typeof received[Symbol.iterator] === 'function') pass = Array.from(received as Iterable<unknown>).includes(item)
        else throw new TypeError(`${show(received)} is not a string or an iterable`)
        return {pass, message: `contain ${show(item)}`}
    },
    toBeUndefined: (_state, received): MatchResult => ({pass: received === undefined, message: 'be undefined'}),
    toBeDefined: (_state, received): MatchResult => ({pass: received !== undefined, message: 'be defined'}),
    toBeNull: (_state, received): MatchResult => ({pass: received === null, message: 'be null'}),
    toBeTruthy: (_state, received): MatchResult => ({pass: !!received, message: 'be truthy'}),
    toBeFalsy: (_state, received): MatchResult => ({pass: !received, message: 'be falsy'}),
    toBeGreaterThan: (_state, received, expected): MatchResult => compare(received, expected, '>', (a, b): boolean => a > b),
    toBeGreaterThanOrEqual: (_state, received, expected): MatchResult => compare(received, expected, '>=', (a, b): boolean => a >= b),
    toBeLessThan: (_state, received, expected): MatchResult => compare(received, expected, '<', (a, b): boolean => a < b),
    toBeLessThanOrEqual: (_state, received, expected): MatchResult => compare(received, expected, '<=', (a, b): boolean => a <= b),
    toBeInstanceOf: (_state, received, expected): MatchResult => ({pass: received instanceof expected, message: `be an instance of ${expected?.name ?? show(expected)}`}),
    toBeTypeOf: (_state, received, type): MatchResult => ({pass: typeof received === type, message: `be of the type ${type}, is of the type ${typeof received}`}),
    toMatch: (_state, received, pattern): MatchResult => {
        if (typeof received !== 'string') throw new TypeError(`${show(received)} is not a string`)
        return {pass: typeof pattern === 'string' ? received.includes(pattern) : pattern.test(received), message: `match ${show(pattern)}`}
    },
    toThrow,
    toThrowError: toThrow,
    toHaveBeenCalled: (_state, received): MatchResult => {
        const count: number = mockOf(received).mock.calls.length
        return {pass: count > 0, message: `be called, called ${count} times`}
    },
    toHaveBeenCalledTimes: calledTimes,
    toBeCalledTimes: calledTimes,
    toHaveBeenCalledWith: (_state, received, ...args): MatchResult => {
        const calls: unknown[][] = mockOf(received).mock.calls
        return {
            pass: calls.some((call: unknown[]): boolean => equals(call, args)),
            message: `be called with ${show(args)}, calls: ${show(calls)}`
        }
    }
}

type MatcherName = keyof typeof matchers

/**
 * The assertions on a value; R is void, or a promise with .resolves and .rejects
 */
export interface Assertion<R = void> {
    not: Assertion<R>
    resolves: Assertion<Promise<void>>
    rejects: Assertion<Promise<void>>

    toBe(expected: unknown): R

    toEqual(expected: unknown): R

    toMatchObject(expected: unknown): R

    toHaveLength(length: number): R

    toContain(item: unknown): R

    toBeUndefined(): R

    toBeDefined(): R

    toBeNull(): R

    toBeTruthy(): R

    toBeFalsy(): R

    toBeGreaterThan(expected: number | bigint): R

    toBeGreaterThanOrEqual(expected: number | bigint): R

    toBeLessThan(expected: number | bigint): R

    toBeLessThanOrEqual(expected: number | bigint): R

    toBeInstanceOf(expected: unknown): R

    toBeTypeOf(type: string): R

    toMatch(pattern: string | RegExp): R

    toThrow(expected?: unknown): R

    toThrowError(expected?: unknown): R

    toHaveBeenCalled(): R

    toHaveBeenCalledTimes(times: number): R

    toBeCalledTimes(times: number): R

    toHaveBeenCalledWith(...args: unknown[]): R
}

function check(name: MatcherName, state: MatcherState, received: unknown, args: unknown[]): void {
    const result: MatchResult = matchers[name](state, received, ...args)
    if (result.pass !== state.negated) return
    const subject: string = state.mode === 'rejects' ? `the rejection ${show(received)}` : show(received)
    throw new AssertionError({
        message: `${state.message ? `${state.message}: ` : ''}${name}: expected ${subject} ${state.negated ? 'not ' : ''}to ${result.message}`,
        actual: result.actual ?? received,
        expected: result.expected,
        operator: name
    })
}

async function settle(received: unknown, mode: 'resolves' | 'rejects'): Promise<unknown> {
    const promise: unknown = typeof received === 'function' ? received() : received
    if (!isPromiseLike(promise)) throw new TypeError(`${show(promise)} is not a promise (.${mode})`)
    const outcome: {resolved: boolean, value: unknown} = await Promise.resolve(promise).then(
        (value: unknown) => ({resolved: true, value}),
        (error: unknown) => ({resolved: false, value: error})
    )
    if (mode === 'resolves' && !outcome.resolved) {
        throw new AssertionError({message: `expected the promise to resolve, it rejected with ${show(outcome.value)}`, operator: 'resolves'})
    }
    if (mode === 'rejects' && outcome.resolved) {
        throw new AssertionError({message: `expected the promise to reject, it resolved with ${show(outcome.value)}`, operator: 'rejects'})
    }
    return outcome.value
}

function createAssertion<R>(received: unknown, state: MatcherState): Assertion<R> {
    const assertion: Record<string, unknown> = {}
    for (const name of Object.keys(matchers)) {
        assertion[name] = (...args: unknown[]): unknown => {
            if (state.mode === 'sync') return check(name, state, received, args)
            return settle(received, state.mode).then((value: unknown): void => check(name, state, value, args))
        }
    }
    Object.defineProperties(assertion, {
        not: {get: () => createAssertion(received, {...state, negated: !state.negated})},
        resolves: {get: () => createAssertion(received, {...state, mode: 'resolves'})},
        rejects: {get: () => createAssertion(received, {...state, mode: 'rejects'})}
    })
    return assertion as unknown as Assertion<R>
}

interface ExpectStatic {
    (received: unknown, message?: string): Assertion

    any(constructor: unknown): any

    anything(): any

    objectContaining(sample: object): any
}

/**
 * Asserts on a value
 */
export const expect: ExpectStatic = Object.assign(
    (received: unknown, message?: string): Assertion => createAssertion<void>(received, {negated: false, mode: 'sync', message}),
    {
        any: (constructor: unknown): any => new Any(constructor),
        anything: (): any => new Anything(),
        objectContaining: (sample: object): any => new ObjectContaining(sample)
    }
)

/* Mocks */

const mockMarker: unique symbol = Symbol('mock')

export interface MockResult {
    type: 'return' | 'throw'
    value: unknown
}

export interface MockState {
    calls: any[][]
    results: MockResult[]
    instances: unknown[]
    readonly lastCall: any[] | undefined
}

export interface Mock<T extends Procedure = Procedure> {
    (...args: Parameters<T>): ReturnType<T>

    mock: MockState

    [mockMarker]: true

    mockImplementation(fn: T): this

    mockImplementationOnce(fn: T): this

    mockReturnValue(value: ReturnType<T>): this

    mockReturnValueOnce(value: ReturnType<T>): this

    mockResolvedValue(value: Awaited<ReturnType<T>>): this

    mockResolvedValueOnce(value: Awaited<ReturnType<T>>): this

    mockRejectedValue(error: unknown): this

    mockRejectedValueOnce(error: unknown): this

    mockClear(): this

    mockReset(): this

    mockRestore(): void
}

function isMock(value: unknown): value is Mock {
    return typeof value === 'function' && (value as Partial<Mock>)[mockMarker] === true
}

//The spies of vi.spyOn(), restored by vi.restoreAllMocks()
const spies: Set<Mock> = new Set()

function createMock<T extends Procedure>(original?: T, restore?: () => void): Mock<T> {
    let implementation: Procedure | undefined = original
    const once: Procedure[] = []
    const state: MockState = {
        calls: [],
        results: [],
        instances: [],
        get lastCall(): any[] | undefined {
            return this.calls[this.calls.length - 1]
        }
    }
    const mock = function (this: unknown, ...args: unknown[]): unknown {
        state.calls.push(args)
        state.instances.push(this)
        const current: Procedure | undefined = once.length > 0 ? once.shift() : implementation
        try {
            const value: unknown = new.target
                ? (current ? Reflect.construct(current, args, new.target) : this)
                : current?.apply(this, args)
            state.results.push({type: 'return', value})
            return value
        } catch (error) {
            state.results.push({type: 'throw', value: error})
            throw error
        }
    } as unknown as Mock<T>
    Object.assign(mock, {
        [mockMarker]: true,
        mock: state,
        mockImplementation: (fn: T): Mock<T> => {
            implementation = fn
            return mock
        },
        mockImplementationOnce: (fn: T): Mock<T> => {
            once.push(fn)
            return mock
        },
        mockReturnValue: (value: unknown): Mock<T> => mock.mockImplementation(((): unknown => value) as T),
        mockReturnValueOnce: (value: unknown): Mock<T> => mock.mockImplementationOnce(((): unknown => value) as T),
        mockResolvedValue: (value: unknown): Mock<T> => mock.mockImplementation(((): Promise<unknown> => Promise.resolve(value)) as T),
        mockResolvedValueOnce: (value: unknown): Mock<T> => mock.mockImplementationOnce(((): Promise<unknown> => Promise.resolve(value)) as T),
        mockRejectedValue: (error: unknown): Mock<T> => mock.mockImplementation(((): Promise<never> => Promise.reject(error)) as T),
        mockRejectedValueOnce: (error: unknown): Mock<T> => mock.mockImplementationOnce(((): Promise<never> => Promise.reject(error)) as T),
        mockClear: (): Mock<T> => {
            state.calls.length = 0
            state.results.length = 0
            state.instances.length = 0
            return mock
        },
        mockReset: (): Mock<T> => {
            mock.mockClear()
            once.length = 0
            implementation = original
            return mock
        },
        mockRestore: (): void => {
            mock.mockReset()
            if (spies.delete(mock as Mock)) restore?.()
        }
    })
    return mock
}

function spyOn<T extends object, K extends keyof T>(object: T, key: K): Mock<T[K] extends Procedure ? T[K] : Procedure> {
    const original: unknown = object[key]
    if (isMock(original)) return original as Mock<any>
    if (typeof original !== 'function') throw new TypeError(`${String(key)} is not a function and cannot be spied on`)
    const descriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(object, key)
    const spy: Mock<any> = createMock(original as Procedure, (): void => {
        if (descriptor) {
            Object.defineProperty(object, key, descriptor)
        } else {
            delete object[key]
        }
    })
    Object.defineProperty(object, key, {value: spy, writable: true, configurable: true, enumerable: descriptor?.enumerable ?? false})
    spies.add(spy)
    return spy
}

/* Fake timers */

class FakeTimeout {
    constructor(public readonly id: number, private readonly clock: FakeClock) {
    }

    public ref(): this {
        return this
    }

    public unref(): this {
        return this
    }

    public hasRef(): boolean {
        return true
    }

    public refresh(): this {
        this.clock.refresh(this.id)
        return this
    }

    public close(): this {
        this.clock.clear(this.id)
        return this
    }

    public [Symbol.toPrimitive](): number {
        return this.id
    }
}

//The order of the timers: by time, the immediates first at the same time, then by creation
function runsBefore(a: FakeTimer, b: FakeTimer): boolean {
    if (a.callAt !== b.callAt) return a.callAt < b.callAt
    if (a.immediate !== b.immediate) return a.immediate
    return a.id < b.id
}

interface FakeTimer {
    id: number
    callAt: number
    delay: number
    callback: Procedure
    args: unknown[]
    interval: boolean
    immediate: boolean
}

/**
 * The clock of the fake timers, as the one of vitest (@sinonjs/fake-timers): it starts at the real time, a timer of 0 ms
 * set while the clock advances runs 1 ms later, and advancing lets the real event loop turn after each timer
 */
class FakeClock {
    public now: number

    private readonly start: number

    private readonly performanceStart: number

    private readonly timers: Map<number, FakeTimer> = new Map()

    private nextId: number = 1

    private advancing: boolean = false

    constructor() {
        this.now = realTimers.Date.now()
        this.start = this.now
        this.performanceStart = performance.now()
    }

    public get count(): number {
        return this.timers.size
    }

    public performanceNow(): number {
        return this.performanceStart + (this.now - this.start)
    }

    public add(callback: Procedure, delay: unknown, args: unknown[], interval: boolean, immediate: boolean = false): FakeTimeout {
        if (typeof callback !== 'function') throw new TypeError('The callback of a timer must be a function')
        let milliseconds: number = Math.trunc(Number(delay))
        if (!Number.isFinite(milliseconds) || milliseconds < 0) milliseconds = 0
        if (milliseconds > 0x7fffffff) milliseconds = 1
        const id: number = this.nextId++
        this.timers.set(id, {
            id,
            callAt: this.now + (milliseconds || (this.advancing ? 1 : 0)),
            delay: interval ? Math.max(1, milliseconds) : milliseconds,
            callback,
            args,
            interval,
            immediate
        })
        return new FakeTimeout(id, this)
    }

    public has(id: number): boolean {
        return this.timers.has(id)
    }

    public clear(id: number): void {
        this.timers.delete(id)
    }

    public refresh(id: number): void {
        const timer: FakeTimer | undefined = this.timers.get(id)
        if (timer) timer.callAt = this.now + timer.delay
    }

    private first(until: number): FakeTimer | undefined {
        let first: FakeTimer | undefined
        for (const timer of this.timers.values()) {
            if (timer.callAt <= until && (!first || runsBefore(timer, first))) first = timer
        }
        return first
    }

    public async advance(milliseconds: number): Promise<void> {
        const target: number = this.now + milliseconds
        let failure: {error: unknown} | undefined
        this.advancing = true
        try {
            await realTurn()
            for (let timer: FakeTimer | undefined = this.first(target); timer; timer = this.first(target)) {
                this.now = Math.max(this.now, timer.callAt)
                if (timer.interval) {
                    timer.callAt += timer.delay
                } else {
                    this.timers.delete(timer.id)
                }
                try {
                    timer.callback(...timer.args)
                } catch (error) {
                    failure ??= {error}
                }
                await realTurn()
            }
        } finally {
            this.advancing = false
        }
        this.now = Math.max(this.now, target)
        if (failure) throw failure.error
    }
}

//A turn of the real event loop: the promises settle and the I/O runs
function realTurn(): Promise<void> {
    return new Promise((resolve: () => void): void => {
        realTimers.setTimeout(resolve, 0)
    })
}

let clock: FakeClock | undefined

function clearFake(handle: unknown, realClear: (handle: any) => void): void {
    if (handle instanceof FakeTimeout) {
        handle.close()
    } else if (clock && typeof handle === 'number' && clock.has(handle)) {
        clock.clear(handle)
    } else {
        realClear(handle)
    }
}

function abortError(signal: AbortSignal): Error {
    const error: Error & {code?: string} = new Error('The operation was aborted', {cause: signal.reason})
    error.name = 'AbortError'
    error.code = 'ABORT_ERR'
    return error
}

function createFakeDate(current: FakeClock): DateConstructor {
    const RealDate: DateConstructor = realTimers.Date
    function FakeDate(this: unknown, ...args: any[]): unknown {
        if (!new.target) return new RealDate(current.now).toString()
        return args.length === 0 ? new RealDate(current.now) : new (RealDate as any)(...args)
    }
    FakeDate.prototype = RealDate.prototype
    FakeDate.now = (): number => current.now
    FakeDate.parse = RealDate.parse
    FakeDate.UTC = RealDate.UTC
    return FakeDate as unknown as DateConstructor
}

function useRealTimers(): void {
    if (!clock) return
    clock = undefined
    Object.assign(globalThis, realTimers)
    //Its own function given back (in Bun, deleting the override deletes the function too)
    Object.defineProperty(performance, 'now', realPerformanceNow)
    timersPromises.setTimeout = realPromiseTimeout
    syncBuiltinESMExports()
}

function useFakeTimers(): void {
    useRealTimers()
    const current: FakeClock = new FakeClock()
    clock = current
    Object.assign(globalThis, {
        setTimeout: (callback: Procedure, delay?: number, ...args: unknown[]): FakeTimeout => current.add(callback, delay, args, false),
        setInterval: (callback: Procedure, delay?: number, ...args: unknown[]): FakeTimeout => current.add(callback, delay, args, true),
        setImmediate: (callback: Procedure, ...args: unknown[]): FakeTimeout => current.add(callback, 0, args, false, true),
        clearTimeout: (handle: unknown): void => clearFake(handle, realTimers.clearTimeout),
        clearInterval: (handle: unknown): void => clearFake(handle, realTimers.clearInterval),
        clearImmediate: (handle: unknown): void => clearFake(handle, realTimers.clearImmediate),
        Date: createFakeDate(current)
    })
    Object.defineProperty(performance, 'now', {value: (): number => current.performanceNow(), writable: true, configurable: true, enumerable: true})
    timersPromises.setTimeout = <T>(delay?: number, value?: T, options: {signal?: AbortSignal} = {}): Promise<T | undefined> => {
        const signal: AbortSignal | undefined = options.signal
        if (signal?.aborted) return Promise.reject(abortError(signal))
        return new Promise((resolve: (value: T | undefined) => void, reject: (error: Error) => void): void => {
            const onAbort = (): void => {
                current.clear(timeout.id)
                reject(abortError(signal!))
            }
            const timeout: FakeTimeout = current.add((): void => {
                signal?.removeEventListener('abort', onAbort)
                resolve(value)
            }, delay, [], false)
            signal?.addEventListener('abort', onAbort, {once: true})
        })
    }
    syncBuiltinESMExports()
}

function fakeClock(): FakeClock {
    if (!clock) throw new Error('The timers are not faked: call vi.useFakeTimers() first')
    return clock
}

/**
 * Retries the callback until it returns without throwing (or its promise resolves), on the real timers
 * @param callback
 * @param options
 */
async function waitFor<T>(callback: () => Awaitable<T>, options: number | {timeout?: number, interval?: number} = {}): Promise<T> {
    const {timeout = 5000, interval = 50} = typeof options === 'number' ? {timeout: options} : options
    const deadline: number = realTimers.Date.now() + timeout
    for (; ;) {
        try {
            return await callback()
        } catch (error) {
            if (realTimers.Date.now() >= deadline) throw error
        }
        await new Promise<void>((resolve: () => void): void => {
            realTimers.setTimeout(resolve, interval)
        })
    }
}

/**
 * The mocks, the spies and the fake timers
 */
export const vi = {
    fn: <T extends Procedure = Procedure>(implementation?: T): Mock<T> => createMock(implementation),
    spyOn,
    mocked: <T>(value: T): T extends Procedure ? Mock<T> : T => value as any,
    restoreAllMocks: (): void => {
        [...spies].reverse().forEach((spy: Mock): void => spy.mockRestore())
    },
    useFakeTimers,
    useRealTimers,
    advanceTimersByTimeAsync: async (milliseconds: number): Promise<void> => {
        await fakeClock().advance(milliseconds)
    },
    getTimerCount: (): number => fakeClock().count,
    waitFor
}
