/**
 * Derived from the upstream lib/types/date.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {assert} from '../../hoek/index.js'
import Any, {type AnySchema} from './any.js'
import * as Common from '../common.js'
import type {SchemaFlags, SchemaRule, ValidationHelpers, ValidationOutcome} from '../model.js'
import {Template} from '../template.js'

/**
 * The date formats
 */
export type DateFormat = 'iso' | 'javascript' | 'unix'

/**
 * The flags of date schemas
 */
export interface DateFlags extends SchemaFlags {
    format?: DateFormat
}

/**
 * The date schema
 */
export interface DateSchema extends AnySchema {
    _flags: DateFlags
    format(format: DateFormat): this
    greater(date: unknown): this
    iso(): this
    less(date: unknown): this
    max(date: unknown): this
    min(date: unknown): this
    timestamp(type?: 'javascript' | 'unix'): this
}

function isDate(value: unknown): boolean {
    return value instanceof Date
}

const DateType: DateSchema = Any.extend<DateSchema>({

    type: 'date',

    coerce: {
        from: ['number', 'string'],
        method(value: unknown, {schema}: ValidationHelpers<DateSchema>): ValidationOutcome {
            return {value: parse(value, schema._flags.format) || value}
        }
    },

    validate(value: unknown, {schema, error, prefs}: ValidationHelpers<DateSchema>): ValidationOutcome | undefined {
        if (value instanceof Date &&
            !isNaN(value.getTime())) {
            return
        }
        const format: DateFormat | undefined = schema._flags.format
        if (!prefs.convert ||
            !format ||
            typeof value !== 'string') {
            return {value, errors: error('date.base')}
        }
        return {value, errors: error('date.format', {format})}
    },

    rules: {

        compare: {
            method: false,
            validate(value: unknown, helpers: ValidationHelpers<DateSchema>, {date}: Record<string, unknown>, {name, operator, args}: SchemaRule): unknown {
                const to: number = date === 'now' ? Date.now() : (date as Date).getTime()
                if (Common.compare((value as Date).getTime(), to, operator as Common.CompareOperator)) return value
                return helpers.error('date.' + name, {limit: (args as Record<string, unknown>).date, value})
            },
            args: [
                {
                    name: 'date',
                    ref: true,
                    normalize: (date: unknown): unknown => {
                        return date === 'now' ? date : parse(date)
                    },
                    assert: (date: unknown): boolean => date !== null,
                    message: 'must have a valid date format'
                }
            ]
        },

        format: {
            method(this: DateSchema, format: DateFormat): DateSchema {
                assert(['iso', 'javascript', 'unix'].includes(format), 'Unknown date format', format)
                return this.$_setFlag('format', format)
            }
        },

        greater: {
            method(this: DateSchema, date: unknown): DateSchema {
                return this.$_addRule({name: 'greater', method: 'compare', args: {date}, operator: '>'})
            }
        },

        iso: {
            method(this: DateSchema): DateSchema {
                return this.format('iso')
            }
        },

        less: {
            method(this: DateSchema, date: unknown): DateSchema {
                return this.$_addRule({name: 'less', method: 'compare', args: {date}, operator: '<'})
            }
        },

        max: {
            method(this: DateSchema, date: unknown): DateSchema {
                return this.$_addRule({name: 'max', method: 'compare', args: {date}, operator: '<='})
            }
        },

        min: {
            method(this: DateSchema, date: unknown): DateSchema {
                return this.$_addRule({name: 'min', method: 'compare', args: {date}, operator: '>='})
            }
        },

        timestamp: {
            method(this: DateSchema, type: 'javascript' | 'unix' = 'javascript'): DateSchema {
                assert(['javascript', 'unix'].includes(type), '"type" must be one of "javascript, unix"')
                return this.format(type)
            }
        }
    },

    cast: {
        number: {
            from: isDate,
            to(value: unknown, helpers: ValidationHelpers<DateSchema>): unknown {
                return (value as Date).getTime()
            }
        },
        string: {
            from: isDate,
            to(value: unknown, {prefs}: ValidationHelpers<DateSchema>): unknown {
                return Template.date(value as Date, prefs)
            }
        }
    },

    messages: {
        'date.base': '{{#label}} must be a valid date',
        'date.format': '{{#label}} must be in {msg("date.format." + #format) || #format} format',
        'date.greater': '{{#label}} must be greater than {{:#limit}}',
        'date.less': '{{#label}} must be less than {{:#limit}}',
        'date.max': '{{#label}} must be less than or equal to {{:#limit}}',
        'date.min': '{{#label}} must be greater than or equal to {{:#limit}}',

        //Messages used in date.format

        'date.format.iso': 'ISO 8601 date',
        'date.format.javascript': 'timestamp or number of milliseconds',
        'date.format.unix': 'timestamp or number of seconds'
    }
})

export default DateType

//Helpers

function parse(value: unknown, format?: DateFormat): Date | null {
    if (value instanceof Date) return value
    if (typeof value !== 'string' &&
        (isNaN(value as number) || !isFinite(value as number))) {
        return null
    }
    if (/^\s*$/.test(value as string)) return null
    //ISO
    if (format === 'iso') {
        if (!Common.isIsoDate(value as string)) return null
        return date((value as string | number).toString())
    }
    //Normalize number string
    const original: unknown = value
    if (typeof value === 'string' &&
        /^[+-]?\d+(\.\d+)?$/.test(value)) {
        value = parseFloat(value)
    }
    //Timestamp
    if (format) {
        //Casting to number
        if (format === 'javascript') return date(1 * (value as number))
        if (format === 'unix') return date(1000 * (value as number))
        if (typeof original === 'string') return null
    }
    //Plain
    return date(value as string | number)
}

function date(value: string | number): Date | null {
    const date: Date = new Date(value)
    if (!isNaN(date.getTime())) return date
    return null
}
