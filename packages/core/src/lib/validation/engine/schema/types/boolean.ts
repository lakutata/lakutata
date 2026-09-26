/**
 * Derived from the upstream lib/types/boolean.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {assert} from '../../hoek/index.js'
import Any, {type AnySchema, type AnyTerms} from './any.js'
import type {SchemaTerms} from '../base.js'
import * as Common from '../common.js'
import type {SchemaFlags, ValidationHelpers, ValidationOutcome} from '../model.js'
import {Values} from '../values.js'

/**
 * The flags of boolean schemas
 */
export interface BooleanFlags extends SchemaFlags {
    sensitive?: boolean
}

/**
 * The terms of boolean schemas
 */
export interface BooleanTerms {
    falsy: Values | null
    truthy: Values | null
}

/**
 * The boolean schema
 */
export interface BooleanSchema extends AnySchema {
    _flags: BooleanFlags
    $_terms: SchemaTerms & AnyTerms & BooleanTerms
    falsy(...values: unknown[]): this
    sensitive(enabled?: boolean): this
    truthy(...values: unknown[]): this
}

function isBool(value: unknown): boolean {
    return typeof value === 'boolean'
}

const BooleanType: BooleanSchema = Any.extend<BooleanSchema>({

    type: 'boolean',

    flags: {

        sensitive: {default: false}
    },

    terms: {

        falsy: {
            init: null,
            manifest: 'values'
        },

        truthy: {
            init: null,
            manifest: 'values'
        }
    },

    coerce(value: unknown, {schema}: ValidationHelpers<BooleanSchema>): ValidationOutcome | undefined {
        if (typeof value === 'boolean') return
        if (typeof value === 'string') {
            const trimmedValue: string = value.trim()
            const normalized: string = schema._flags.sensitive ? trimmedValue : trimmedValue.toLowerCase()
            value = normalized === 'true' ? true : (normalized === 'false' ? false : value)
        }
        if (typeof value !== 'boolean') {
            value = schema.$_terms.truthy && schema.$_terms.truthy.has(value, null, null, !schema._flags.sensitive) ||
                (schema.$_terms.falsy && schema.$_terms.falsy.has(value, null, null, !schema._flags.sensitive) ? false : value)
        }
        return {value}
    },

    validate(value: unknown, {error}: ValidationHelpers<BooleanSchema>): ValidationOutcome | undefined {
        if (typeof value !== 'boolean') return {value, errors: error('boolean.base')}
    },

    rules: {
        truthy: {
            method(this: BooleanSchema, ...values: unknown[]): BooleanSchema {
                Common.verifyFlat(values, 'truthy')
                const obj: BooleanSchema = this.clone()
                obj.$_terms.truthy = obj.$_terms.truthy || new Values()
                for (let i: number = 0; i < values.length; ++i) {
                    const value: unknown = values[i]
                    assert(value !== undefined, 'Cannot call truthy with undefined')
                    obj.$_terms.truthy.add(value)
                }
                return obj
            }
        },

        falsy: {
            method(this: BooleanSchema, ...values: unknown[]): BooleanSchema {
                Common.verifyFlat(values, 'falsy')
                const obj: BooleanSchema = this.clone()
                obj.$_terms.falsy = obj.$_terms.falsy || new Values()
                for (let i: number = 0; i < values.length; ++i) {
                    const value: unknown = values[i]
                    assert(value !== undefined, 'Cannot call falsy with undefined')
                    obj.$_terms.falsy.add(value)
                }
                return obj
            }
        },

        sensitive: {
            method(this: BooleanSchema, enabled: boolean = true): BooleanSchema {
                return this.$_setFlag('sensitive', enabled)
            }
        }
    },

    cast: {
        number: {
            from: isBool,
            to(value: unknown, helpers: ValidationHelpers<BooleanSchema>): unknown {
                return value ? 1 : 0
            }
        },
        string: {
            from: isBool,
            to(value: unknown, helpers: ValidationHelpers<BooleanSchema>): unknown {
                return value ? 'true' : 'false'
            }
        }
    },

    manifest: {

        build(obj: BooleanSchema, desc: Record<string, unknown>): BooleanSchema {
            if (desc.truthy) obj = obj.truthy(...(desc.truthy as unknown[]))
            if (desc.falsy) obj = obj.falsy(...(desc.falsy as unknown[]))
            return obj
        }
    },

    messages: {
        'boolean.base': '{{#label}} must be a boolean'
    }
})

export default BooleanType
