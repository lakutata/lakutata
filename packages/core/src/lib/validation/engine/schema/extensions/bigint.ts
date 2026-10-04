/**
 * Derived from the upstream src/index.ts and src/types.ts (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md)
 */
import type * as Ref from '../ref.js'
import type {Extension, ExtensionFactory, Root} from '../index.js'
import type {ValidationHelpers, ValidationOutcome} from '../model.js'
import type {AnySchema} from '../types/any.js'

/**
 * The bigint schema
 * @typeParam T the validated value type (kept for compatibility with the upstream type, which is generic)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface BigIntSchema<T = bigint> extends AnySchema {
    greater(limit: bigint | Ref.Ref): this
    less(limit: bigint | Ref.Ref): this
    max(limit: bigint | Ref.Ref): this
    min(limit: bigint | Ref.Ref): this
    multiple(base: bigint | Ref.Ref): this
    negative(): this
    port(): this
    positive(): this
    sign(sign: 'positive' | 'negative'): this
}

const isBigint = (value: unknown): value is bigint => typeof value === 'bigint'

type Helpers = ValidationHelpers<BigIntSchema>

/**
 * The bigint extension of the root object
 * @param _engine the root object (extend() requires the factories of the extensions to take it)
 */
export const bigintExtension = (_engine: Root): Extension<BigIntSchema> => ({
    type: 'bigint',
    messages: {
        'bigint.base': '{{#label}} must be a bigint',
        'bigint.greater': '{{#label}} must be greater than {{#limit}}',
        'bigint.less': '{{#label}} must be less than {{#limit}}',
        'bigint.max': '{{#label}} must be less than or equal to {{#limit}}',
        'bigint.min': '{{#label}} must be greater than or equal to {{#limit}}',
        'bigint.multiple': '{{#label}} must be a multiple of {{#base}}',
        'bigint.negative': '{{#label}} must be a negative number',
        'bigint.port': '{{#label}} must be a valid port',
        'bigint.positive': '{{#label}} must be a positive number'
    },
    coerce(value: unknown): ValidationOutcome {
        if (typeof value === 'string' || (typeof value === 'number' && Number.isInteger(value))) {
            try {
                return {value: BigInt(value)}
            } catch {
                //Not convertible: validate() reports it
            }
        }
        return {value}
    },
    validate(value: unknown, helpers: Helpers): ValidationOutcome | undefined {
        if (!isBigint(value)) return {value, errors: helpers.error('bigint.base')}
    },
    rules: {
        greater: {
            method(this: BigIntSchema, limit: bigint | Ref.Ref): BigIntSchema {
                return this.$_addRule({name: 'greater', args: {limit}})
            },
            validate(value: unknown, helpers: Helpers, {limit}: Record<string, unknown>): unknown {
                return (value as bigint) > (limit as bigint) ? value : helpers.error('bigint.greater', {limit: (limit as bigint).toString()})
            },
            args: [
                {
                    name: 'limit',
                    ref: true,
                    assert: isBigint,
                    message: 'must be a bigint'
                }
            ]
        },
        less: {
            method(this: BigIntSchema, limit: bigint | Ref.Ref): BigIntSchema {
                return this.$_addRule({name: 'less', args: {limit}})
            },
            validate(value: unknown, helpers: Helpers, {limit}: Record<string, unknown>): unknown {
                return (value as bigint) < (limit as bigint) ? value : helpers.error('bigint.less', {limit: (limit as bigint).toString()})
            },
            args: [
                {
                    name: 'limit',
                    ref: true,
                    assert: isBigint,
                    message: 'must be a bigint'
                }
            ]
        },
        max: {
            method(this: BigIntSchema, limit: bigint | Ref.Ref): BigIntSchema {
                return this.$_addRule({name: 'max', args: {limit}})
            },
            validate(value: unknown, helpers: Helpers, {limit}: Record<string, unknown>): unknown {
                return (value as bigint) <= (limit as bigint) ? value : helpers.error('bigint.max', {limit: (limit as bigint).toString()})
            },
            args: [
                {
                    name: 'limit',
                    ref: true,
                    assert: isBigint,
                    message: 'must be a bigint'
                }
            ]
        },
        min: {
            method(this: BigIntSchema, limit: bigint | Ref.Ref): BigIntSchema {
                return this.$_addRule({name: 'min', args: {limit}})
            },
            validate(value: unknown, helpers: Helpers, {limit}: Record<string, unknown>): unknown {
                return (value as bigint) >= (limit as bigint) ? value : helpers.error('bigint.min', {limit: (limit as bigint).toString()})
            },
            args: [
                {
                    name: 'limit',
                    ref: true,
                    assert: isBigint,
                    message: 'must be a bigint'
                }
            ]
        },
        multiple: {
            method(this: BigIntSchema, base: bigint | Ref.Ref): BigIntSchema {
                return this.$_addRule({name: 'multiple', args: {base}})
            },
            validate(value: unknown, helpers: Helpers, {base}: Record<string, unknown>): unknown {
                //A multiple of the base: 0 and the negative multiples included, as the numbers (upstream refused the
                //values lower than the base)
                return (value as bigint) % (base as bigint) === 0n
                    ? value
                    : helpers.error('bigint.multiple', {base: (base as bigint).toString()})
            },
            args: [
                {
                    name: 'base',
                    ref: true,
                    assert: (base: unknown): boolean => isBigint(base) && (base as bigint) > 0n,
                    message: 'must be a positive bigint'
                }
            ],
            multi: true
        },
        negative: {
            method(this: BigIntSchema): BigIntSchema {
                return this.$_addRule({name: 'negative'})
            },
            validate(value: unknown, helpers: Helpers): unknown {
                return (value as bigint) < 0n ? value : helpers.error('bigint.negative')
            }
        },
        port: {
            method(this: BigIntSchema): BigIntSchema {
                return this.$_addRule({name: 'port'})
            },
            validate(value: unknown, helpers: Helpers): unknown {
                return (value as bigint) >= 0n && (value as bigint) <= 65535n ? value : helpers.error('bigint.port')
            }
        },
        positive: {
            method(this: BigIntSchema): BigIntSchema {
                return this.$_addRule({name: 'positive'})
            },
            validate(value: unknown, helpers: Helpers): unknown {
                return (value as bigint) > 0n ? value : helpers.error('bigint.positive')
            }
        },
        sign: {
            method(this: BigIntSchema, sign: 'positive' | 'negative'): BigIntSchema {
                return this.$_addRule({name: 'sign', args: {sign}})
            },
            validate(value: unknown, helpers: Helpers, {sign}: Record<string, unknown>): unknown {
                return (sign === 'negative' && (value as bigint) < 0n) || (sign === 'positive' && (value as bigint) > 0n)
                    ? value
                    : helpers.error(`bigint.${sign as string}`)
            },
            args: [
                {
                    name: 'sign',
                    assert: (value: unknown): boolean => ['negative', 'positive'].includes(value as string),
                    message: 'must be "negative" or "positive"'
                }
            ]
        }
    }
})

/**
 * A root object with the bigint type
 * @param baseEngine
 */
export const extendBigInt = <T extends Root>(baseEngine: T): T & { bigint<U = bigint>(): BigIntSchema<U> } => {
    //The extension is typed with its own schema type, the root accepts the extensions of any schema type
    return baseEngine.extend(bigintExtension as unknown as ExtensionFactory) as T & { bigint<U = bigint>(): BigIntSchema<U> }
}
