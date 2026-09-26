/**
 * Derived from joi 18.0.2 lib/types/function.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {assert} from '../../hoek/index.js'
import type {ValidationHelpers} from '../model.js'
import Keys, {type KeysSchema} from './keys.js'

/**
 * The function schema: keys (of the function object), and arity rules
 */
export interface FunctionSchema extends KeysSchema {
    arity(n: number): this
    class(): this
    minArity(n: number): this
    maxArity(n: number): this
}

const FunctionType: FunctionSchema = Keys.extend<FunctionSchema>({

    type: 'function',

    properties: {
        typeof: 'function'
    },

    rules: {
        arity: {
            method(this: FunctionSchema, n: number): FunctionSchema {
                assert(Number.isSafeInteger(n) && n >= 0, 'n must be a positive integer')
                return this.$_addRule({name: 'arity', args: {n}})
            },
            validate(value: unknown, helpers: ValidationHelpers<FunctionSchema>, {n}: Record<string, unknown>): unknown {
                if ((value as Function).length === n) return value
                return helpers.error('function.arity', {n})
            }
        },

        class: {
            method(this: FunctionSchema): FunctionSchema {
                return this.$_addRule('class')
            },
            validate(value: unknown, helpers: ValidationHelpers<FunctionSchema>): unknown {
                if ((/^\s*class\s/).test((value as Function).toString())) return value
                return helpers.error('function.class', {value})
            }
        },

        minArity: {
            method(this: FunctionSchema, n: number): FunctionSchema {
                assert(Number.isSafeInteger(n) && n > 0, 'n must be a strict positive integer')
                return this.$_addRule({name: 'minArity', args: {n}})
            },
            validate(value: unknown, helpers: ValidationHelpers<FunctionSchema>, {n}: Record<string, unknown>): unknown {
                if ((value as Function).length >= (n as number)) return value
                return helpers.error('function.minArity', {n})
            }
        },

        maxArity: {
            method(this: FunctionSchema, n: number): FunctionSchema {
                assert(Number.isSafeInteger(n) && n >= 0, 'n must be a positive integer')
                return this.$_addRule({name: 'maxArity', args: {n}})
            },
            validate(value: unknown, helpers: ValidationHelpers<FunctionSchema>, {n}: Record<string, unknown>): unknown {
                if ((value as Function).length <= (n as number)) return value
                return helpers.error('function.maxArity', {n})
            }
        }
    },

    messages: {
        'function.arity': '{{#label}} must have an arity of {{#n}}',
        'function.class': '{{#label}} must be a class',
        'function.maxArity': '{{#label}} must have an arity lesser or equal to {{#n}}',
        'function.minArity': '{{#label}} must have an arity greater or equal to {{#n}}'
    }
})

export default FunctionType
