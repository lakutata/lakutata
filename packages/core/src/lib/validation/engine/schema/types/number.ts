/**
 * Derived from the upstream lib/types/number.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {assert} from '../assert.js'
import Any, {type AnySchema} from './any.js'
import * as Common from '../common.js'
import type {SchemaFlags, SchemaRule, ValidationHelpers, ValidationOutcome} from '../model.js'

/**
 * The flags of number schemas
 */
export interface NumberFlags extends SchemaFlags {
    unsafe?: boolean
}

/**
 * The number schema
 */
export interface NumberSchema extends AnySchema {
    _flags: NumberFlags
    double(): this
    float(): this
    greater(limit: unknown): this
    int8(): this
    int16(): this
    int32(): this
    int64(): this
    integer(): this
    less(limit: unknown): this
    max(limit: unknown): this
    min(limit: unknown): this
    multiple(base: unknown): this
    negative(): this
    port(): this
    positive(): this
    precision(limit: number): this
    sign(sign: 'negative' | 'positive'): this
    uint8(): this
    uint16(): this
    uint32(): this
    uint64(): this
    unsafe(enabled?: boolean): this
}

/**
 * The ranges of the integer types (the 64-bit types are limited to the safe integers of JavaScript)
 */
export const integerTypes: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
    int8: [-128, 127],
    uint8: [0, 255],
    int16: [-32768, 32767],
    uint16: [0, 65535],
    int32: [-2147483648, 2147483647],
    uint32: [0, 4294967295],
    int64: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    uint64: [0, Number.MAX_SAFE_INTEGER]
})

/**
 * The largest finite 32-bit floating point number
 */
export const FLOAT_MAX: number = 3.4028234663852886e38

/**
 * The rule of an integer type
 * @param name
 */
function integerRule(name: string): Record<string, unknown> {
    const [min, max] = integerTypes[name]
    return {
        method(this: NumberSchema): NumberSchema {
            return this.$_addRule(name)
        },
        validate(value: unknown, helpers: ValidationHelpers<NumberSchema>): unknown {
            if (!Number.isInteger(value)) return helpers.error('number.integer')
            if ((value as number) < min || (value as number) > max) return helpers.error(`number.${name}`, {min, max})
            return value
        }
    }
}

const numberRx: RegExp = /^\s*[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:e([+-]?\d+))?\s*$/i
const precisionRx: RegExp = /(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/
const exponentialPartRegex: RegExp = /[eE][+-]?\d+$/
const leadingSignAndZerosRegex: RegExp = /^[+-]?(0*)?/
const dotRegex: RegExp = /\./
const trailingZerosRegex: RegExp = /0+$/

function decimalPlaces(value: number): number {
    const str: string = value.toString()
    const dindex: number = str.indexOf('.')
    const eindex: number = str.indexOf('e')
    return (
        (dindex < 0 ? 0 : (eindex < 0 ? str.length : eindex) - dindex - 1) +
        (eindex < 0 ? 0 : Math.max(0, -parseInt(str.slice(eindex + 1))))
    )
}

const NumberType: NumberSchema = Any.extend<NumberSchema>({

    type: 'number',

    flags: {

        unsafe: {default: false}
    },

    coerce: {
        from: 'string',
        method(value: unknown, {schema, error}: ValidationHelpers<NumberSchema>): ValidationOutcome | undefined {
            let str: string = value as string
            const matches: RegExpMatchArray | null = str.match(numberRx)
            if (!matches) return
            str = str.trim()
            const result: ValidationOutcome & { value: number } = {value: parseFloat(str)}
            //-0
            if (result.value === 0) result.value = 0
            if (!schema._flags.unsafe) {
                if (str.match(/e/i)) {
                    if (extractSignificantDigits(str) !== extractSignificantDigits(String(result.value))) {
                        result.errors = error('number.unsafe')
                        return result
                    }
                } else {
                    const string: string = result.value.toString()
                    if (string.match(/e/i)) return result
                    if (string !== normalizeDecimal(str)) {
                        result.errors = error('number.unsafe')
                        return result
                    }
                }
            }
            return result
        }
    },

    validate(value: unknown, {schema, error, prefs}: ValidationHelpers<NumberSchema>): ValidationOutcome {
        if (value === Infinity ||
            value === -Infinity) {
            return {value, errors: error('number.infinity')}
        }
        if (!Common.isNumber(value)) return {value, errors: error('number.base')}
        const result: ValidationOutcome & { value: number } = {value}
        if (prefs.convert) {
            const rule: SchemaRule | undefined = schema.$_getRule('precision')
            if (rule) {
                //This is conceptually equivalent to using toFixed but it should be much faster
                const precision: number = Math.pow(10, (rule.args as Record<string, unknown>).limit as number)
                result.value = Math.round(result.value * precision) / precision
            }
        }
        //-0
        if (result.value === 0) result.value = 0
        if (!schema._flags.unsafe &&
            (value > Number.MAX_SAFE_INTEGER || value < Number.MIN_SAFE_INTEGER)) {
            result.errors = error('number.unsafe')
        }
        return result
    },

    rules: {

        compare: {
            method: false,
            validate(value: unknown, helpers: ValidationHelpers<NumberSchema>, {limit}: Record<string, unknown>, {name, operator, args}: SchemaRule): unknown {
                if (Common.compare(value, limit, operator as Common.CompareOperator)) return value
                return helpers.error('number.' + name, {limit: (args as Record<string, unknown>).limit, value})
            },
            args: [
                {
                    name: 'limit',
                    ref: true,
                    assert: Common.isNumber,
                    message: 'must be a number'
                }
            ]
        },

        double: {
            method(this: NumberSchema): NumberSchema {
                //Every finite number is a 64-bit floating point number: the rule declares the type, beyond the safe integers
                return this.unsafe().$_addRule('double')
            },
            validate(value: unknown): unknown {
                return value
            }
        },

        float: {
            method(this: NumberSchema): NumberSchema {
                //Floating point numbers are not limited to the safe integers
                return this.unsafe().$_addRule('float')
            },
            validate(value: unknown, helpers: ValidationHelpers<NumberSchema>): unknown {
                //The range of the 32-bit floating point numbers (the value is rounded to the nearest one when stored)
                if (Math.abs(value as number) <= FLOAT_MAX) return value
                return helpers.error('number.float', {min: -FLOAT_MAX, max: FLOAT_MAX})
            }
        },

        greater: {
            method(this: NumberSchema, limit: unknown): NumberSchema {
                return this.$_addRule({name: 'greater', method: 'compare', args: {limit}, operator: '>'})
            }
        },

        int8: integerRule('int8'),

        int16: integerRule('int16'),

        int32: integerRule('int32'),

        int64: integerRule('int64'),

        integer: {
            method(this: NumberSchema): NumberSchema {
                return this.$_addRule('integer')
            },
            validate(value: unknown, helpers: ValidationHelpers<NumberSchema>): unknown {
                if (Math.trunc(value as number) - (value as number) === 0) return value
                return helpers.error('number.integer')
            }
        },

        less: {
            method(this: NumberSchema, limit: unknown): NumberSchema {
                return this.$_addRule({name: 'less', method: 'compare', args: {limit}, operator: '<'})
            }
        },

        max: {
            method(this: NumberSchema, limit: unknown): NumberSchema {
                return this.$_addRule({name: 'max', method: 'compare', args: {limit}, operator: '<='})
            }
        },

        min: {
            method(this: NumberSchema, limit: unknown): NumberSchema {
                return this.$_addRule({name: 'min', method: 'compare', args: {limit}, operator: '>='})
            }
        },

        multiple: {
            method(this: NumberSchema, base: unknown): NumberSchema {
                const baseDecimalPlace: number | null = typeof base === 'number' ? decimalPlaces(base) : null
                //Math.pow(10, null) is 1, like upstream
                const pfactor: number = Math.pow(10, baseDecimalPlace as number)
                return this.$_addRule({
                    name: 'multiple',
                    args: {
                        base,
                        baseDecimalPlace,
                        pfactor
                    }
                })
            },
            validate(value: unknown, helpers: ValidationHelpers<NumberSchema>, {base, baseDecimalPlace, pfactor}: Record<string, unknown>, options: SchemaRule): unknown {
                const valueDecimalPlace: number = decimalPlaces(value as number)
                if (valueDecimalPlace > (baseDecimalPlace as number)) {
                    //Value with higher precision than base can never be a multiple
                    return helpers.error('number.multiple', {multiple: (options.args as Record<string, unknown>).base, value})
                }
                return Math.round((pfactor as number) * (value as number)) % Math.round((pfactor as number) * (base as number)) === 0 ?
                    value :
                    helpers.error('number.multiple', {multiple: (options.args as Record<string, unknown>).base, value})
            },
            args: [
                {
                    name: 'base',
                    ref: true,
                    assert: (value: unknown): boolean => typeof value === 'number' && isFinite(value) && value > 0,
                    message: 'must be a positive number'
                },
                'baseDecimalPlace',
                'pfactor'
            ],
            multi: true
        },

        negative: {
            method(this: NumberSchema): NumberSchema {
                return this.sign('negative')
            }
        },

        port: {
            method(this: NumberSchema): NumberSchema {
                return this.$_addRule('port')
            },
            validate(value: unknown, helpers: ValidationHelpers<NumberSchema>): unknown {
                if (Number.isSafeInteger(value) &&
                    (value as number) >= 0 &&
                    (value as number) <= 65535) {
                    return value
                }
                return helpers.error('number.port')
            }
        },

        positive: {
            method(this: NumberSchema): NumberSchema {
                return this.sign('positive')
            }
        },

        precision: {
            method(this: NumberSchema, limit: number): NumberSchema {
                assert(Number.isSafeInteger(limit), 'limit must be an integer')
                return this.$_addRule({name: 'precision', args: {limit}})
            },
            validate(value: unknown, helpers: ValidationHelpers<NumberSchema>, {limit}: Record<string, unknown>): unknown {
                const places: RegExpMatchArray = (value as number).toString().match(precisionRx) as RegExpMatchArray
                const decimals: number = Math.max((places[1] ? places[1].length : 0) - (places[2] ? parseInt(places[2], 10) : 0), 0)
                if (decimals <= (limit as number)) return value
                return helpers.error('number.precision', {limit, value})
            },
            convert: true
        },

        sign: {
            method(this: NumberSchema, sign: 'negative' | 'positive'): NumberSchema {
                assert(['negative', 'positive'].includes(sign), 'Invalid sign', sign)
                return this.$_addRule({name: 'sign', args: {sign}})
            },
            validate(value: unknown, helpers: ValidationHelpers<NumberSchema>, {sign}: Record<string, unknown>): unknown {
                if (sign === 'negative' && (value as number) < 0 ||
                    sign === 'positive' && (value as number) > 0) {
                    return value
                }
                return helpers.error(`number.${sign}`)
            }
        },

        uint8: integerRule('uint8'),

        uint16: integerRule('uint16'),

        uint32: integerRule('uint32'),

        uint64: integerRule('uint64'),

        unsafe: {
            method(this: NumberSchema, enabled: boolean = true): NumberSchema {
                assert(typeof enabled === 'boolean', 'enabled must be a boolean')
                return this.$_setFlag('unsafe', enabled)
            }
        }
    },

    cast: {
        string: {
            from: (value: unknown): boolean => typeof value === 'number',
            to(value: unknown): unknown {
                return (value as number).toString()
            }
        }
    },

    messages: {
        'number.base': '{{#label}} must be a number',
        'number.float': '{{#label}} must be a valid Float value (between {{#min}} and {{#max}})',
        'number.greater': '{{#label}} must be greater than {{#limit}}',
        'number.infinity': '{{#label}} cannot be infinity',
        'number.int8': '{{#label}} must be a valid Int8 value (between -128 and 127)',
        'number.int16': '{{#label}} must be a valid Int16 value (between -32768 and 32767)',
        'number.int32': '{{#label}} must be a valid Int32 value (between -2147483648 and 2147483647)',
        'number.int64': '{{#label}} must be a valid Int64 value (between -9007199254740991 and 9007199254740991, the safe integers of JavaScript)',
        'number.integer': '{{#label}} must be an integer',
        'number.less': '{{#label}} must be less than {{#limit}}',
        'number.max': '{{#label}} must be less than or equal to {{#limit}}',
        'number.min': '{{#label}} must be greater than or equal to {{#limit}}',
        'number.multiple': '{{#label}} must be a multiple of {{#multiple}}',
        'number.negative': '{{#label}} must be a negative number',
        'number.port': '{{#label}} must be a valid port',
        'number.positive': '{{#label}} must be a positive number',
        'number.precision': '{{#label}} must have no more than {{#limit}} decimal places',
        'number.uint8': '{{#label}} must be a valid UInt8 value (between 0 and 255)',
        'number.uint16': '{{#label}} must be a valid UInt16 value (between 0 and 65535)',
        'number.uint32': '{{#label}} must be a valid UInt32 value (between 0 and 4294967295)',
        'number.uint64': '{{#label}} must be a valid UInt64 value (between 0 and 9007199254740991, the safe integers of JavaScript)',
        'number.unsafe': '{{#label}} must be a safe number'
    }
})

export default NumberType

//Helpers

function extractSignificantDigits(value: string): string {
    return value
        .replace(exponentialPartRegex, '')
        .replace(dotRegex, '')
        .replace(trailingZerosRegex, '')
        .replace(leadingSignAndZerosRegex, '')
}

function normalizeDecimal(str: string): string {
    str = str
        //Remove leading plus signs
        .replace(/^\+/, '')
        //Remove trailing zeros if there is a decimal point and unecessary decimal points
        .replace(/\.0*$/, '')
        //Add a integer 0 if the numbers starts with a decimal point
        .replace(/^(-?)\.([^\.]*)$/, '$10.$2')
        //Remove leading zeros
        .replace(/^(-?)0+([0-9])/, '$1$2')
    if (str.includes('.') &&
        str.endsWith('0')) {
        str = str.replace(/0+$/, '')
    }
    if (str === '-0') return '0'
    return str
}
