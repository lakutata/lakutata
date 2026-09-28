import assert from 'node:assert'

type Matchers = {
    toBe(expected: unknown): void
    toEqual(expected: unknown): void
    toBeInstanceOf(expected: Function): void
    toBeUndefined(): void
    toBeNull(): void
    toBeDefined(): void
    toBeLessThan(expected: number): void
    toBeGreaterThan(expected: number): void
    toBeGreaterThanOrEqual(expected: number): void
    toThrow(expected?: string | RegExp | Function): void
}

/**
 * The matchers of a value, negated or not
 * @param actual
 * @param negated
 */
function Matchers(actual: any, negated: boolean): Matchers {
    const check = (passed: boolean, message: string): void => assert.ok(negated ? !passed : passed, negated ? `not: ${message}` : message)
    return {
        toBe: (expected: unknown): void => negated ? assert.notStrictEqual(actual, expected) : assert.strictEqual(actual, expected),
        toEqual: (expected: unknown): void => negated ? assert.notDeepStrictEqual(actual, expected) : assert.deepStrictEqual(actual, expected),
        toBeInstanceOf: (expected: Function): void => check(actual instanceof expected, `expected an instance of ${expected.name}`),
        toBeUndefined: (): void => check(actual === undefined, `expected undefined, got ${String(actual)}`),
        toBeNull: (): void => check(actual === null, `expected null, got ${String(actual)}`),
        toBeDefined: (): void => check(actual !== undefined, 'expected a defined value'),
        toBeLessThan: (expected: number): void => check(actual < expected, `expected ${actual} < ${expected}`),
        toBeGreaterThan: (expected: number): void => check(actual > expected, `expected ${actual} > ${expected}`),
        toBeGreaterThanOrEqual: (expected: number): void => check(actual >= expected, `expected ${actual} >= ${expected}`),
        toThrow: (expected?: string | RegExp | Function): void => {
            let error: unknown
            try {
                actual()
            } catch (e) {
                error = e
            }
            if (negated) return assert.strictEqual(error, undefined)
            assert.ok(error !== undefined, 'expected a throw')
            if (typeof expected === 'string') assert.ok(String((error as Error).message).includes(expected))
            else if (expected instanceof RegExp) assert.match(String((error as Error).message), expected)
            else if (typeof expected === 'function') assert.ok(error instanceof expected)
        }
    }
}

/**
 * Jest style assertions on node:assert, for the tests ported from the bun test runner
 * @param actual
 */
export function expect(actual: unknown): Matchers & { not: Matchers } {
    return {...Matchers(actual, false), not: Matchers(actual, true)}
}
