import {MathArgumentException} from '../exceptions/MathArgumentException.js'
import {MathCancelledException} from '../exceptions/MathCancelledException.js'
import {MathDefinitionException} from '../exceptions/MathDefinitionException.js'
import {MathDivisionByZeroException} from '../exceptions/MathDivisionByZeroException.js'
import {MathDomainException} from '../exceptions/MathDomainException.js'
import {MathException} from '../exceptions/MathException.js'
import {MathNotSupportedException} from '../exceptions/MathNotSupportedException.js'
import {MathSyntaxException} from '../exceptions/MathSyntaxException.js'
import {MathTimeoutException} from '../exceptions/MathTimeoutException.js'
import {MathUnitException} from '../exceptions/MathUnitException.js'
import {MathUnknownFunctionException} from '../exceptions/MathUnknownFunctionException.js'
import {addon} from './Addon.js'

/**
 * A native object of the addon (an expression, a scope of definitions, a compiled function, a token): opaque, released
 * when it is collected
 */
export type Handle = object & { readonly __nativeHandle: never }

/**
 * A formula parsed: an expression, an equation, an inequality
 */
export interface NativeParsed {
    kind: 'expression' | 'equation' | 'relation' | 'matrix'
    left: Handle
    right?: Handle
    relation?: '=' | '<' | '>' | '<=' | '>='
    matrix?: NativeMatrixOfExpressions
}

/**
 * A matrix of expressions, as the addon gives it
 */
export interface NativeMatrixOfExpressions {
    matrix: Handle
    rows: number
    columns: number
}

/**
 * The solutions of an equation, as the addon gives them
 */
export interface NativeSolutions {
    kind: 'finite' | 'empty' | 'all' | 'intervals' | 'unsolved' | 'other'
    values: Handle[]
    intervals: { start: Handle, end: Handle, startOpen: boolean, endOpen: boolean }[]
    text?: string
}

/**
 * The functions of the addon (native/addon.cpp)
 */
interface NativeAddon {
    versions(): { symengine: string, mpdecimal: string, eigen: string, threads: number }
    scope(parent: Handle | null, definitions: [string, string][]): Handle
    parse(scope: Handle, text: string): NativeParsed
    text(expression: Handle): string
    tex(expression: Handle): string
    number(value: number): Handle
    toNumber(expression: Handle): number
    toComplex(expression: Handle): [number, number]
    variables(expression: Handle): string[]
    compile(expression: Handle, variables: string[]): Handle
    call(compiled: Handle, ...values: number[]): number
    callBatch(compiled: Handle, inputs: Float64Array): Float64Array
    token(): Handle
    cancel(token: Handle, reason: 'cancelled' | 'timeout'): void
    run(operation: string, args: unknown[]): unknown
    runAsync(operation: string, args: unknown[], token?: Handle): Promise<unknown>
}

const EXCEPTIONS: Record<string, new (message: string) => MathException> = {
    E_MATH_SYNTAX: MathSyntaxException,
    E_MATH_UNKNOWN_FUNCTION: MathUnknownFunctionException,
    E_MATH_DEFINITION: MathDefinitionException,
    E_MATH_DOMAIN: MathDomainException,
    E_MATH_DIVISION_BY_ZERO: MathDivisionByZeroException,
    E_MATH_NOT_SUPPORTED: MathNotSupportedException,
    E_MATH_UNIT: MathUnitException,
    E_MATH_CANCELLED: MathCancelledException,
    E_MATH_TIMEOUT: MathTimeoutException,
    E_MATH_ARGUMENT: MathArgumentException
}

/**
 * The exception of an error of the addon (its code), the error itself otherwise
 * @param error
 */
export function toException(error: unknown): unknown {
    if (!(error instanceof Error) || error instanceof MathException) return error
    const code: unknown = (error as Error & { code?: unknown }).code
    if (typeof code !== 'string' || !code.startsWith('E_MATH_')) return error
    const exception: MathException = new (EXCEPTIONS[code] ?? MathException)(error.message)
    const position: unknown = (error as Error & { position?: unknown }).position
    if (typeof position === 'number') exception.position = position
    return exception
}

/**
 * Call a function of the addon, its errors thrown as the exceptions of the package
 * @param call
 */
export function nativeCall<T>(call: (native: NativeAddon) => T): T {
    try {
        return call(addon as NativeAddon)
    } catch (error) {
        throw toException(error)
    }
}

/**
 * The addon, for the calls that cannot fail (its versions)
 */
export const native: NativeAddon = addon as NativeAddon
