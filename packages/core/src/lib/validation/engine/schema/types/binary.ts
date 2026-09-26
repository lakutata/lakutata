/**
 * Derived from the upstream lib/types/binary.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {assert} from '../assert.js'
import Any, {type AnySchema} from './any.js'
import * as Common from '../common.js'
import type {SchemaFlags, SchemaRule, ValidationHelpers, ValidationOutcome} from '../model.js'

/**
 * The flags of binary schemas
 */
export interface BinaryFlags extends SchemaFlags {
    encoding?: BufferEncoding
}

/**
 * The binary schema
 */
export interface BinarySchema extends AnySchema {
    _flags: BinaryFlags
    encoding(encoding: BufferEncoding): this
    length(limit: unknown): this
    max(limit: unknown): this
    min(limit: unknown): this
}

const BinaryType: BinarySchema = Any.extend<BinarySchema>({

    type: 'binary',

    coerce: {
        from: ['string', 'object'],
        method(value: unknown, {schema}: ValidationHelpers<BinarySchema>): ValidationOutcome | undefined {
            if (typeof value === 'string' || (value !== null && (value as { type?: unknown }).type === 'Buffer')) {
                try {
                    //A serialized buffer ({type: 'Buffer', data: [...]}) is accepted by Buffer.from() too
                    return {value: Buffer.from(value as string, schema._flags.encoding)}
                } catch {
                }
            }
        }
    },

    validate(value: unknown, {error}: ValidationHelpers<BinarySchema>): ValidationOutcome | undefined {
        if (!Buffer.isBuffer(value)) return {value, errors: error('binary.base')}
    },

    rules: {
        encoding: {
            method(this: BinarySchema, encoding: BufferEncoding): BinarySchema {
                assert(Buffer.isEncoding(encoding), 'Invalid encoding:', encoding)
                return this.$_setFlag('encoding', encoding)
            }
        },

        length: {
            method(this: BinarySchema, limit: unknown): BinarySchema {
                return this.$_addRule({name: 'length', method: 'length', args: {limit}, operator: '='})
            },
            validate(value: unknown, helpers: ValidationHelpers<BinarySchema>, {limit}: Record<string, unknown>, {name, operator, args}: SchemaRule): unknown {
                if (Common.compare((value as Buffer).length, limit, operator as Common.CompareOperator)) return value
                return helpers.error('binary.' + name, {limit: (args as Record<string, unknown>).limit, value})
            },
            args: [
                {
                    name: 'limit',
                    ref: true,
                    assert: Common.limit,
                    message: 'must be a positive integer'
                }
            ]
        },

        max: {
            method(this: BinarySchema, limit: unknown): BinarySchema {
                return this.$_addRule({name: 'max', method: 'length', args: {limit}, operator: '<='})
            }
        },

        min: {
            method(this: BinarySchema, limit: unknown): BinarySchema {
                return this.$_addRule({name: 'min', method: 'length', args: {limit}, operator: '>='})
            }
        }
    },

    cast: {
        string: {
            from: (value: unknown): boolean => Buffer.isBuffer(value),
            to(value: unknown, helpers: ValidationHelpers<BinarySchema>): unknown {
                return (value as Buffer).toString()
            }
        }
    },

    messages: {
        'binary.base': '{{#label}} must be a buffer or a string',
        'binary.length': '{{#label}} must be {{#limit}} bytes',
        'binary.max': '{{#label}} must be less than or equal to {{#limit}} bytes',
        'binary.min': '{{#label}} must be at least {{#limit}} bytes'
    }
})

export default BinaryType
