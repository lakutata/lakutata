/**
 * Derived from the upstream lib/types/alternatives.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {merge} from '../../hoek/index.js'
import {assert} from '../assert.js'
import type {Base, SchemaTerms} from '../base.js'
import * as Common from '../common.js'
import * as Compile from '../compile.js'
import * as Errors from '../errors.js'
import type {ModifyEachSource} from '../modify.js'
import type {ValidationHelpers, ValidationOutcome} from '../model.js'
import * as Ref from '../ref.js'
import type {State} from '../state.js'
import type {SchemaResult} from '../validator.js'
import Any, {type AnySchema, type AnyTerms} from './any.js'

/**
 * The match modes of an alternatives schema
 */
export type AlternativesMatchMode = 'any' | 'one' | 'all' | 'none'

/**
 * An item of the matches term: an alternative schema, a condition, or a switch statement
 */
export interface AlternativesMatch {
    schema?: Base
    ref?: Ref.Ref
    is?: Base
    then?: Base
    otherwise?: Base
    switch?: Compile.WhenCase[]
}

/**
 * The terms of an alternatives schema
 */
export interface AlternativesTerms {
    matches: AlternativesMatch[]
}

/**
 * The alternatives schema: matches any (or one, or all) of the alternative schemas, or the conditions
 */
export interface AlternativesSchema extends AnySchema {
    $_terms: SchemaTerms & AnyTerms & AlternativesTerms
    conditional(condition: unknown, options: Compile.WhenOptions | Compile.WhenSwitchCase[]): this
    match(mode: AlternativesMatchMode): this
    try(...schemas: unknown[]): this
}

/**
 * An item of the matches of a schema description
 */
interface MatchDescription {
    schema?: unknown
    ref?: unknown
    is?: unknown
    not?: unknown
    then?: unknown
    otherwise?: unknown
    switch?: Compile.WhenSwitchCase[]
}

/**
 * The errors of an alternative schema which failed
 */
interface Failure {
    schema: Base
    reports: Errors.ErrorItem[]
}

const Alternatives: AlternativesSchema = Any.extend<AlternativesSchema>({

    type: 'alternatives',

    flags: {

        //'any', 'one', 'all'
        match: {default: 'any'}
    },

    terms: {

        matches: {init: [], register: Ref.toSibling}
    },

    args(schema: AlternativesSchema, ...schemas: unknown[]): AlternativesSchema {
        if (schemas.length === 1) {
            if (Array.isArray(schemas[0])) {
                return schema.try(...schemas[0])
            }
        }
        return schema.try(...schemas)
    },

    validate(value: unknown, helpers: ValidationHelpers<AlternativesSchema>): ValidationOutcome {
        const {schema, error, state, prefs} = helpers
        //Match none (lakutata's own): the value must not match any alternative
        if (schema._flags.match === 'none') {
            for (let i: number = 0; i < schema.$_terms.matches.length; ++i) {
                const item: AlternativesMatch = schema.$_terms.matches[i]
                if ((item.schema as Base).$_match(value, state.nest(item.schema, `match.${i}`), prefs)) return {errors: error('alternatives.none')}
            }
            return {value}
        }
        //Match all or one
        if (schema._flags.match) {
            const matched: unknown[] = []
            const failed: Errors.ErrorItem[][] = []
            for (let i: number = 0; i < schema.$_terms.matches.length; ++i) {
                const item: AlternativesMatch = schema.$_terms.matches[i]
                const localState: State = state.nest(item.schema, `match.${i}`)
                localState.snapshot()
                const result: SchemaResult = (item.schema as Base).$_validate(value, localState, prefs)
                if (!result.errors) {
                    matched.push(result.value)
                    localState.commit()
                } else {
                    failed.push(result.errors)
                    localState.restore()
                }
            }
            if (matched.length === 0) {
                const context: Errors.ReportLocal = {
                    details: failed.map((f: Errors.ErrorItem[]): Errors.ErrorsDetails => Errors.details(f, {override: false}))
                }
                return {errors: error('alternatives.any', context)}
            }
            //Match one
            if (schema._flags.match === 'one') {
                return matched.length === 1 ? {value: matched[0]} : {errors: error('alternatives.one')}
            }
            //Match all
            if (matched.length !== schema.$_terms.matches.length) {
                const context: Errors.ReportLocal = {
                    details: failed.map((f: Errors.ErrorItem[]): Errors.ErrorsDetails => Errors.details(f, {override: false}))
                }
                return {errors: error('alternatives.all', context)}
            }
            const isAnyObj = (alternative: AlternativesSchema): boolean => {
                return alternative.$_terms.matches.some((v: AlternativesMatch): boolean => {
                    //Like upstream: conditions of nested alternatives have no schema
                    return (v.schema as Base).type === 'object' ||
                        ((v.schema as Base).type === 'alternatives' && isAnyObj(v.schema as AlternativesSchema))
                })
            }
            //Only plain objects are merged, into a new object (upstream merges into the first matched value, which may
            //be the validated value itself: an array is emptied; and it merges the null an object schema allows, and throws)
            const objects: boolean = matched.every((v: unknown): boolean => v !== null && typeof v === 'object' && !Array.isArray(v))
            return isAnyObj(schema) && objects ? {value: matched.reduce((acc: unknown, v: unknown): unknown => merge(acc as object, v as object, {mergeArrays: false}), Object.create(Object.getPrototypeOf(matched[0])))} : {value: matched[matched.length - 1]}
        }
        //Match any
        const errors: Failure[] = []
        for (let i: number = 0; i < schema.$_terms.matches.length; ++i) {
            const item: AlternativesMatch = schema.$_terms.matches[i]
            //Try
            if (item.schema) {
                const localState: State = state.nest(item.schema, `match.${i}`)
                localState.snapshot()
                const result: SchemaResult = item.schema.$_validate(value, localState, prefs)
                if (!result.errors) {
                    localState.commit()
                    return result
                }
                localState.restore()
                errors.push({schema: item.schema, reports: result.errors})
                continue
            }
            //Conditional
            const input: unknown = item.ref ? item.ref.resolve(value, state, prefs, undefined) : value
            const tests: (AlternativesMatch | Compile.WhenCase)[] = item.is ? [item] : item.switch as Compile.WhenCase[]
            for (let j: number = 0; j < tests.length; ++j) {
                const test: AlternativesMatch | Compile.WhenCase = tests[j]
                const {is, then, otherwise} = test
                const id: string = `match.${i}${item.switch ? '.' + j : ''}`
                if (!(is as Base).$_match(input, state.nest(is, `${id}.is`), prefs)) {
                    if (otherwise) {
                        return otherwise.$_validate(value, state.nest(otherwise, `${id}.otherwise`), prefs)
                    }
                } else if (then) {
                    return then.$_validate(value, state.nest(then, `${id}.then`), prefs)
                }
            }
        }
        return reportErrors(errors, helpers)
    },

    rules: {

        conditional: {
            method(this: AlternativesSchema, condition: unknown, options: Compile.WhenOptions | Compile.WhenSwitchCase[]): AlternativesSchema {
                assert(!this._flags._endedSwitch, 'Unreachable condition')
                assert(!this._flags.match, 'Cannot combine match mode', this._flags.match, 'with conditional rule')
                assert((options as Compile.WhenOptions).break === undefined, 'Cannot use break option with alternatives conditional')
                const obj: AlternativesSchema = this.clone()
                const match: AlternativesMatch = Compile.when(obj, condition, options)
                const conditions: (AlternativesMatch | Compile.WhenCase)[] = match.is ? [match] : match.switch as Compile.WhenCase[]
                for (const item of conditions) {
                    if (item.then &&
                        item.otherwise) {
                        obj.$_setFlag('_endedSwitch', true, {clone: false})
                        break
                    }
                }
                obj.$_terms.matches.push(match)
                return obj.$_mutateRebuild()
            }
        },

        match: {
            method(this: AlternativesSchema, mode: AlternativesMatchMode): AlternativesSchema {
                assert(['any', 'one', 'all', 'none'].includes(mode), 'Invalid alternatives match mode', mode)
                if (mode !== 'any') {
                    for (const match of this.$_terms.matches) {
                        assert(match.schema, 'Cannot combine match mode', mode, 'with conditional rules')
                    }
                }
                return this.$_setFlag('match', mode)
            }
        },

        try: {
            method(this: AlternativesSchema, ...schemas: unknown[]): AlternativesSchema {
                assert(schemas.length, 'Missing alternative schemas')
                Common.verifyFlat(schemas, 'try')
                assert(!this._flags._endedSwitch, 'Unreachable condition')
                const obj: AlternativesSchema = this.clone()
                for (const schema of schemas) {
                    obj.$_terms.matches.push({schema: obj.$_compile(schema)})
                }
                return obj.$_mutateRebuild()
            }
        }
    },

    overrides: {

        label(this: AlternativesSchema, name: string): AlternativesSchema {
            const obj: AlternativesSchema = this.$_parent('label', name) as AlternativesSchema
            const each = (item: unknown, source: ModifyEachSource): Base | undefined => {
                return source.path[0] !== 'is' && typeof (item as Base)._flags.label !== 'string' ? (item as Base).label(name) : undefined
            }
            return obj.$_modify({each, ref: false})
        },

        isAsync(this: AlternativesSchema): boolean {
            if (this.$_terms.externals?.length) {
                return true
            }
            for (const match of this.$_terms.matches) {
                if (match.schema?.isAsync()) {
                    return true
                }
                if (match.then?.isAsync()) {
                    return true
                }
                if (match.otherwise?.isAsync()) {
                    return true
                }
            }
            return false
        }
    },

    rebuild(schema: AlternativesSchema): void {
        //Flag when an alternative type is an array
        const each = (item: unknown): void => {
            if (Common.isSchema(item) &&
                (item as Base).type === 'array') {
                schema.$_setFlag('_arrayItems', true, {clone: false})
            }
        }
        schema.$_modify({each})
    },

    manifest: {

        build(obj: AlternativesSchema, desc: Record<string, unknown>): AlternativesSchema {
            if (desc.matches) {
                for (const match of desc.matches as MatchDescription[]) {
                    const {schema, ref, is, not, then, otherwise} = match
                    if (schema) {
                        obj = obj.try(schema)
                    } else if (ref) {
                        obj = obj.conditional(ref, {is, then, not, otherwise, switch: match.switch})
                    } else {
                        obj = obj.conditional(is, {then, otherwise})
                    }
                }
            }
            return obj
        }
    },

    messages: {
        'alternatives.all': '{{#label}} does not match all of the required types',
        'alternatives.any': '{{#label}} does not match any of the allowed types',
        'alternatives.match': '{{#label}} does not match any of the allowed types',
        'alternatives.none': '{{#label}} matches a type which is not allowed',
        'alternatives.one': '{{#label}} matches more than one allowed type',
        'alternatives.types': '{{#label}} must be one of {{#types}}'
    }
})

export default Alternatives

//Helpers

function reportErrors(failures: Failure[], {error, state}: ValidationHelpers<AlternativesSchema>): ValidationOutcome {
    //Nothing matched due to type criteria rules
    if (!failures.length) {
        return {errors: error('alternatives.any')}
    }
    //Single error
    if (failures.length === 1) {
        return {errors: failures[0].reports}
    }
    //Analyze reasons
    const valids: Set<unknown> = new Set()
    const complex: { type: string, report: Errors.Report }[] = []
    for (const {reports, schema} of failures) {
        //Multiple errors (!abortEarly)
        if (reports.length > 1) {
            return unmatched(failures, error)
        }
        //Custom error
        const report: Errors.Report = reports[0] as Errors.Report
        if (report instanceof Errors.Report === false) {
            return unmatched(failures, error)
        }
        //Internal object or array error
        if (report.state.path.length !== state.path.length) {
            complex.push({type: schema.type, report})
            continue
        }
        //Valids
        if (report.code === 'any.only') {
            for (const valid of report.local.valids as Iterable<unknown>) {
                valids.add(valid)
            }
            continue
        }
        //Base type
        const [type, code] = report.code.split('.')
        if (code !== 'base') {
            complex.push({type: schema.type, report})
        } else if (report.code === 'object.base') {
            valids.add(report.local.type)
        } else {
            valids.add(type)
        }
    }
    //All errors are base types or valids
    if (!complex.length) {
        return {errors: error('alternatives.types', {types: [...valids]})}
    }
    //Single complex error
    if (complex.length === 1) {
        return {errors: complex[0].report}
    }
    return unmatched(failures, error)
}

function unmatched(failures: Failure[], error: ValidationHelpers['error']): ValidationOutcome {
    const errors: Errors.ErrorItem[] = []
    for (const failure of failures) {
        errors.push(...failure.reports)
    }
    return {errors: error('alternatives.match', Errors.details(errors, {override: false}) as Errors.ReportLocal)}
}
