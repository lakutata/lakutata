import {ResolutionStack} from './Container.js'
import {DependencyInjectionException} from '../../exceptions/DependencyInjectionException.js'

/**
 * Newline.
 */
const EOL: string = '\n'

/**
 * An extendable error class.
 */
export class ExtendableError extends DependencyInjectionException {
    /**
     * Constructor for the error.
     *
     * @param  {String} message
     * The error message.
     */
    constructor(message: string) {
        super(message)

        // extending Error is weird and does not propagate `message`
        Object.defineProperty(this, 'message', {
            enumerable: false,
            value: message
        })

        Object.defineProperty(this, 'name', {
            enumerable: false,
            value: this.constructor.name
        })

        // Not all browsers have this function.
        /* istanbul ignore else */
        if ('captureStackTrace' in Error) {
            Error.captureStackTrace(this, this.constructor)
        } else {
            Object.defineProperty(this, 'stack', {
                enumerable: false,
                value: (Error as ErrorConstructor)(message).stack,
                writable: true,
                configurable: true
            })
        }
    }
}

/**
 * Error thrown to indicate a type mismatch.
 */
export class DependencyInjectionTypeError extends ExtendableError {
    /**
     * Constructor, takes the function name, expected and given
     * type to produce an error.
     *
     * @param {string} funcDescription
     * Name of the function being guarded.
     *
     * @param {string} paramName
     * The parameter there was an issue with.
     *
     * @param {string} expectedType
     * Name of the expected type.
     *
     * @param {string} givenType
     * Name of the given type.
     */
    constructor(
        funcDescription: string,
        paramName: string,
        expectedType: string,
        givenType: any
    ) {
        super(
            `${funcDescription}: expected ${paramName} to be ${expectedType}, but got ${givenType}.`
        )
    }

    /**
     * Asserts the given condition, throws an error otherwise.
     *
     * @param {*} condition
     * The condition to check
     *
     * @param {string} funcDescription
     * Name of the function being guarded.
     *
     * @param {string} paramName
     * The parameter there was an issue with.
     *
     * @param {string} expectedType
     * Name of the expected type.
     *
     * @param {string} givenType
     * Name of the given type.
     */
    static assert<T>(
        condition: T,
        funcDescription: string,
        paramName: string,
        expectedType: string,
        givenType: any
    ) {
        if (!condition) {
            throw new DependencyInjectionTypeError(
                funcDescription,
                paramName,
                expectedType,
                givenType
            )
        }
        return condition
    }
}

/**
 * A nice error class, so we can do an instanceOf check.
 */
export class DependencyInjectionResolutionError extends ExtendableError {
    /**
     * Constructor, takes the registered modules and unresolved tokens
     * to create a message.
     *
     * @param {string|symbol} name
     * The name of the module that could not be resolved.
     *
     * @param  {string[]} resolutionStack
     * The current resolution stack
     */
    constructor(
        name: string | symbol,
        resolutionStack: ResolutionStack,
        message?: string
    ) {
        if (typeof name === 'symbol') {
            name = (name as any).toString()
        }
        resolutionStack = resolutionStack.map((val) =>
            typeof val === 'symbol' ? (val as any).toString() : val
        )
        resolutionStack.push(name)
        const resolutionPathString = resolutionStack.join(' -> ')
        let msg = `Could not resolve '${name as any}'.`
        if (message) {
            msg += ` ${message}`
        }

        msg += EOL + EOL
        msg += `Resolution path: ${resolutionPathString}`
        super(msg)
    }
}
