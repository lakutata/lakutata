/**
 * Derived from the upstream lib/types/any.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {assert} from '../../hoek/index.js'
import base, {type AlterationTerm, type Base, type SchemaTerms, type WhenTerm} from '../base.js'
import * as Common from '../common.js'
import type {ReportLocal} from '../errors.js'
import * as Messages from '../messages.js'
import type {SchemaRule, ValidationHelpers} from '../model.js'

/**
 * A custom rule method: the validated (or converted) value, or an error
 */
export type CustomMethod = (value: unknown, helpers: ValidationHelpers) => unknown

/**
 * The terms of any schema
 */
export interface AnyTerms {
    alterations: AlterationTerm[] | null
    examples: unknown[] | null
    externals: unknown[] | null
    metas: unknown[]
    notes: string[]
    shared: Base[] | null
    tags: string[]
    whens: WhenTerm[] | null
}

/**
 * The any schema: Base with the rules and modifiers shared by all the types
 */
export interface AnySchema extends Base {
    $_terms: SchemaTerms & AnyTerms
    custom(method: CustomMethod, description?: string): this
    messages(messages: Messages.MessagesInput): this
    shared(schema: Base): this
    warning(code: string, local?: ReportLocal): this
    keep(enabled?: boolean): this
    message(message: Messages.MessagesInput): this
    warn(enabled?: boolean): this
}

/**
 * A schema method called by the manifest builder with a described value
 */
type BuildMethod = (this: AnySchema, value: unknown) => AnySchema

function callBuild(obj: AnySchema, method: string, value: unknown): AnySchema {
    return ((obj as unknown as Record<string, BuildMethod>)[method]).call(obj, value)
}

const Any: AnySchema = base.extend<AnySchema>({

    type: 'any',

    flags: {

        only: {default: false}
    },

    terms: {

        alterations: {init: null},
        examples: {init: null},
        externals: {init: null},
        metas: {init: []},
        notes: {init: []},
        shared: {init: null},
        tags: {init: []},
        whens: {init: null}
    },

    rules: {

        custom: {
            method(this: AnySchema, method: CustomMethod, description?: string): AnySchema {
                assert(typeof method === 'function', 'Method must be a function')
                assert(description === undefined || description && typeof description === 'string', 'Description must be a non-empty string')
                return this.$_addRule({name: 'custom', args: {method, description}})
            },
            validate(value: unknown, helpers: ValidationHelpers<AnySchema>, {method}: Record<string, unknown>): unknown {
                try {
                    return (method as CustomMethod)(value, helpers)
                } catch (err) {
                    return helpers.error('any.custom', {error: err})
                }
            },
            args: ['method', 'description'],
            multi: true
        },

        messages: {
            method(this: AnySchema, messages: Messages.MessagesInput): AnySchema {
                return this.prefs({messages})
            }
        },

        shared: {
            method(this: AnySchema, schema: Base): AnySchema {
                assert(Common.isSchema(schema) && schema._flags.id, 'Schema must be a schema with an id')
                const obj: AnySchema = this.clone()
                obj.$_terms.shared = obj.$_terms.shared || []
                obj.$_terms.shared.push(schema)
                obj.$_mutateRegister(schema)
                return obj
            }
        },

        warning: {
            method(this: AnySchema, code: string, local?: ReportLocal): AnySchema {
                assert(code && typeof code === 'string', 'Invalid warning code')
                return this.$_addRule({name: 'warning', args: {code, local}, warn: true})
            },
            validate(value: unknown, helpers: ValidationHelpers<AnySchema>, {code, local}: Record<string, unknown>): unknown {
                return helpers.error(code as string, local as ReportLocal | undefined)
            },
            args: ['code', 'local'],
            multi: true
        }
    },

    modifiers: {

        keep(rule: SchemaRule, enabled: unknown = true): void {
            rule.keep = enabled
        },

        message(rule: SchemaRule, message: unknown): void {
            rule.message = Messages.compile(message as Messages.MessagesInput)
        },

        warn(rule: SchemaRule, enabled: unknown = true): void {
            rule.warn = enabled
        }
    },

    manifest: {

        build(obj: AnySchema, desc: Record<string, unknown>): AnySchema {
            for (const key in desc) {
                const values: unknown[] = desc[key] as unknown[]
                if (['examples', 'externals', 'metas', 'notes', 'tags'].includes(key)) {
                    for (const value of values) obj = callBuild(obj, key.slice(0, -1), value)
                    continue
                }
                if (key === 'alterations') {
                    const alter: Record<string, AlterationTerm['adjuster']> = {}
                    for (const {target, adjuster} of values as AlterationTerm[]) alter[target] = adjuster
                    obj = obj.alter(alter)
                    continue
                }
                if (key === 'whens') {
                    for (const value of values as (WhenTerm & { not?: unknown })[]) {
                        const {ref, is, not, then, otherwise, concat} = value
                        if (concat) {
                            obj = obj.concat(concat)
                        } else if (ref) {
                            obj = obj.when(ref, {is, not, then, otherwise, switch: value.switch, break: value.break})
                        } else {
                            obj = obj.when(is, {then, otherwise, break: value.break})
                        }
                    }
                    continue
                }
                if (key === 'shared') {
                    for (const value of values as Base[]) obj = obj.shared(value)
                }
            }
            return obj
        }
    },

    messages: {
        'any.custom': '{{#label}} failed custom validation because {{#error.message}}',
        'any.default': '{{#label}} threw an error when running default method',
        'any.failover': '{{#label}} threw an error when running failover method',
        'any.invalid': '{{#label}} contains an invalid value',
        'any.only': '{{#label}} must be {if(#valids.length == 1, "", "one of ")}{{#valids}}',
        'any.ref': '{{#label}} {{#arg}} references {{:#ref}} which {{#reason}}',
        'any.required': '{{#label}} is required',
        'any.unknown': '{{#label}} is not allowed'
    }
})

export default Any
