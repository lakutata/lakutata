/**
 * Derived from joi 18.0.2 lib/types/number.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {assert} from '../../hoek/index.js'
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
    greater(limit: unknown): this
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
    unsafe(enabled?: boolean): this
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

        greater: {
            method(this: NumberSchema, limit: unknown): NumberSchema {
                return this.$_addRule({name: 'greater', method: 'compare', args: {limit}, operator: '>'})
            }
        },

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
            to(value: unknown, helpers: ValidationHelpers<NumberSchema>): unknown {
                return (value as number).toString()
            }
        }
    },

    messages: {
        'number.base': '{{#label}} must be a number',
        'number.greater': '{{#label}} must be greater than {{#limit}}',
        'number.infinity': '{{#label}} cannot be infinity',
        'number.integer': '{{#label}} must be an integer',
        'number.less': '{{#label}} must be less than {{#limit}}',
        'number.max': '{{#label}} must be less than or equal to {{#limit}}',
        'number.min': '{{#label}} must be greater than or equal to {{#limit}}',
        'number.multiple': '{{#label}} must be a multiple of {{#multiple}}',
        'number.negative': '{{#label}} must be a negative number',
        'number.port': '{{#label}} must be a valid port',
        'number.positive': '{{#label}} must be a positive number',
        'number.precision': '{{#label}} must have no more than {{#limit}} decimal places',
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
