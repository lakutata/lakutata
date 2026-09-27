/**
 * Assertions of the schema definitions: a failed assertion throws a SchemaDefinitionException (the message is built like
 * the assertions of the utilities, see utils/assert.ts)
 */
import {Exception} from '../../../foundation/Exception.js'
import {SchemaDefinitionException} from '../../exceptions/SchemaDefinitionException.js'
import {AssertError, stringify} from '../utils/index.js'

/**
 * A definition exception, with the stack from the caller of the given function
 * @param message
 * @param caller
 * @param cause
 */
export function definitionException(message: string, caller: Function, cause?: unknown): SchemaDefinitionException {
    const exception: SchemaDefinitionException = new SchemaDefinitionException(message || 'Unknown error')
    if (typeof Error.captureStackTrace === 'function') Error.captureStackTrace(exception, caller)
    if (cause !== undefined) exception.cause = cause
    return exception
}

/**
 * Set the message of an error (lakutata: a framework exception keeps its message in errMsg too)
 * @param err
 * @param message
 */
export function setMessage(err: Error, message: string): void {
    err.message = message
    if (err instanceof Exception) (err as { errMsg: string }).errMsg = message
}

/**
 * Assert a condition of a schema definition
 * @param condition
 * @param args the message parts (an Error alone is thrown as is)
 */
export function assert(condition: unknown, ...args: unknown[]): asserts condition {
    if (condition) return
    if (args.length === 1 && args[0] instanceof Error) throw args[0]
    const msgs: string[] = args
        .filter((arg: unknown): boolean => arg !== '')
        .map((arg: unknown): string => typeof arg === 'string' ? arg : arg instanceof Error ? arg.message : stringify(arg))
    throw definitionException(msgs.join(' '), assert)
}

/**
 * Call a utility (utils, sorter, address) with definition inputs: its assertion errors become definition exceptions
 * @param fn
 */
export function definition<T>(fn: () => T): T {
    try {
        return fn()
    } catch (err) {
        if (err instanceof AssertError) throw definitionException(err.message, definition, err)
        throw err
    }
}
