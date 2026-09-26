/**
 * Derived from the upstream lib/types/array.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {assert, deepEqual, reach} from '../../hoek/index.js'
import type {Base, SchemaTerms} from '../base.js'
import * as Common from '../common.js'
import * as Compile from '../compile.js'
import type {ErrorItem, Report, ReportLocal} from '../errors.js'
import type {PathKey, Preferences, SchemaRule, SchemaRuleOptions, ValidationHelpers, ValidationOutcome} from '../model.js'
import type {Ref} from '../ref.js'
import type {State} from '../state.js'
import type {SchemaResult} from '../validator.js'
import Any, {type AnySchema, type AnyTerms} from './any.js'

/**
 * A validated array (which may be flagged as a single value converted to an array)
 */
type ArrayValue = unknown[] & Record<symbol, unknown>

/**
 * A custom unique comparator: truthy when both values are duplicates
 */
export type UniqueComparator = (a: unknown, b: unknown) => unknown

export interface UniqueOptions {
    ignoreUndefined?: boolean
    separator?: string | false
}

export interface SortOptions {
    by?: unknown
    order?: 'ascending' | 'descending'
}

/**
 * The normalized options of the sort rule
 */
interface SortSettings {
    order: string
    by?: Ref
}

/**
 * The terms of array schemas
 */
export interface ArrayTerms {
    items: Base[]
    ordered: Base[]
    _exclusions: Base[]
    _inclusions: Base[]
    _requireds: Base[]
}

/**
 * The array schema
 */
export interface ArraySchema extends AnySchema {
    $_terms: SchemaTerms & AnyTerms & ArrayTerms
    has(schema: unknown): this
    items(...schemas: unknown[]): this
    length(limit: unknown): this
    max(limit: unknown): this
    min(limit: unknown): this
    ordered(...schemas: unknown[]): this
    single(enabled?: unknown): this
    sort(options?: SortOptions): this
    sparse(enabled?: unknown): this
    unique(comparator?: string | UniqueComparator, options?: UniqueOptions): this
}

const ArrayType: ArraySchema = Any.extend<ArraySchema>({

    type: 'array',

    flags: {

        single: {default: false},
        sparse: {default: false}
    },

    terms: {

        items: {init: [], manifest: 'schema'},
        ordered: {init: [], manifest: 'schema'},

        _exclusions: {init: []},
        _inclusions: {init: []},
        _requireds: {init: []}
    },

    coerce: {
        from: 'object',
        method(value: unknown, {schema, state, prefs}: ValidationHelpers<ArraySchema>): ValidationOutcome | undefined {
            if (!Array.isArray(value)) return
            const sort: SchemaRule | undefined = schema.$_getRule('sort')
            if (!sort) return
            return sortArray(schema, value, (sort.args as Record<string, unknown>).options as SortSettings, state, prefs)
        }
    },

    validate(value: unknown, {schema, error}: ValidationHelpers<ArraySchema>): ValidationOutcome | undefined {
        if (!Array.isArray(value)) {
            if (schema._flags.single) {
                const single: ArrayValue = [value] as ArrayValue
                single[Common.symbols.arraySingle] = true
                return {value: single}
            }
            return {errors: error('array.base')}
        }
        if (!schema.$_getRule('items') &&
            !schema.$_terms.externals) {
            return
        }
        //Clone the array so that we don't modify the original
        return {value: value.slice()}
    },

    rules: {

        has: {
            method(this: ArraySchema, schema: unknown): ArraySchema {
                schema = this.$_compile(schema, {appendPath: true})
                const obj: ArraySchema = this.$_addRule({name: 'has', args: {schema}})
                obj.$_mutateRegister(schema)
                return obj
            },
            validate(input: unknown, {state, prefs, error}: ValidationHelpers<ArraySchema>, {schema}: Record<string, unknown>): unknown {
                const value: ArrayValue = input as ArrayValue
                const has: Base = schema as Base
                const ancestors: unknown[] = [value, ...state.ancestors]
                for (let i: number = 0; i < value.length; ++i) {
                    const localState: State = state.localize([...state.path, i], ancestors, has)
                    if (has.$_match(value[i], localState, prefs)) return value
                }
                const patternLabel: string | undefined = has._flags.label
                if (patternLabel) return error('array.hasKnown', {patternLabel})
                return error('array.hasUnknown', null)
            },
            multi: true
        },

        items: {
            method(this: ArraySchema, ...schemas: unknown[]): ArraySchema {
                Common.verifyFlat(schemas, 'items')
                const obj: ArraySchema = this.$_addRule('items')
                for (let i: number = 0; i < schemas.length; ++i) {
                    const type: Base = Common.tryWithPath((): Base => this.$_compile(schemas[i]), i, {append: true})
                    obj.$_terms.items.push(type)
                }
                return obj.$_mutateRebuild()
            },
            validate(input: unknown, {schema, error, state, prefs, errorsArray}: ValidationHelpers<ArraySchema>): unknown {
                const value: ArrayValue = input as ArrayValue
                const requireds: Base[] = schema.$_terms._requireds.slice()
                const ordereds: Base[] = schema.$_terms.ordered.slice()
                const inclusions: Base[] = [...schema.$_terms._inclusions, ...requireds]
                const wasArray: boolean = !value[Common.symbols.arraySingle]
                delete value[Common.symbols.arraySingle]
                const errors: ErrorItem[] = errorsArray()
                let il: number = value.length
                for (let i: number = 0; i < il; ++i) {
                    const item: unknown = value[i]
                    let errored: boolean = false
                    let isValid: boolean = false
                    //A Number object key for a single value converted to an array
                    const key: PathKey = wasArray ? i : new Number(i) as unknown as number
                    const path: PathKey[] = [...state.path, key]
                    //Sparse
                    if (!schema._flags.sparse &&
                        item === undefined) {
                        errors.push(error('array.sparse', {key, path, pos: i, value: undefined}, state.localize(path)))
                        if (prefs.abortEarly) return errors
                        ordereds.shift()
                        continue
                    }
                    //Exclusions
                    const ancestors: unknown[] = [value, ...state.ancestors]
                    for (const exclusion of schema.$_terms._exclusions) {
                        if (!exclusion.$_match(item, state.localize(path, ancestors, exclusion), prefs, {presence: 'ignore' as Preferences['presence']})) {
                            continue
                        }
                        errors.push(error('array.excludes', {pos: i, value: item}, state.localize(path)))
                        if (prefs.abortEarly) return errors
                        errored = true
                        ordereds.shift()
                        break
                    }
                    if (errored) continue
                    //Ordered
                    if (schema.$_terms.ordered.length) {
                        if (ordereds.length) {
                            const ordered: Base = ordereds.shift() as Base
                            const res: SchemaResult = ordered.$_validate(item, state.localize(path, ancestors, ordered), prefs)
                            if (!res.errors) {
                                if (ordered._flags.result === 'strip') {
                                    fastSplice(value, i)
                                    --i
                                    --il
                                } else if (!schema._flags.sparse && res.value === undefined) {
                                    errors.push(error('array.sparse', {key, path, pos: i, value: undefined}, state.localize(path)))
                                    if (prefs.abortEarly) return errors
                                    continue
                                } else {
                                    value[i] = res.value
                                }
                            } else {
                                errors.push(...res.errors)
                                if (prefs.abortEarly) return errors
                            }
                            continue
                        } else if (!schema.$_terms.items.length) {
                            errors.push(error('array.orderedLength', {pos: i, limit: schema.$_terms.ordered.length}))
                            if (prefs.abortEarly) return errors
                            //No reason to continue since there are no other rules to validate other than array.orderedLength
                            break
                        }
                    }
                    //Requireds
                    const requiredChecks: SchemaResult[] = []
                    let jl: number = requireds.length
                    for (let j: number = 0; j < jl; ++j) {
                        const localState: State = state.localize(path, ancestors, requireds[j])
                        localState.snapshot()
                        const res: SchemaResult = requireds[j].$_validate(item, localState, prefs)
                        requiredChecks[j] = res
                        if (!res.errors) {
                            localState.commit()
                            value[i] = res.value
                            isValid = true
                            fastSplice(requireds, j)
                            --j
                            --jl
                            if (!schema._flags.sparse &&
                                res.value === undefined) {
                                errors.push(error('array.sparse', {key, path, pos: i, value: undefined}, state.localize(path)))
                                if (prefs.abortEarly) return errors
                            }
                            break
                        }
                        localState.restore()
                    }
                    if (isValid) continue
                    //Inclusions
                    const stripUnknown: boolean = prefs.stripUnknown && !!(prefs.stripUnknown as { arrays?: boolean }).arrays || false
                    jl = inclusions.length
                    for (const inclusion of inclusions) {
                        //Avoid re-running requireds that already didn't match in the previous loop
                        let res: SchemaResult
                        const previousCheck: number = requireds.indexOf(inclusion)
                        if (previousCheck !== -1) {
                            res = requiredChecks[previousCheck]
                        } else {
                            const localState: State = state.localize(path, ancestors, inclusion)
                            localState.snapshot()
                            res = inclusion.$_validate(item, localState, prefs)
                            if (!res.errors) {
                                localState.commit()
                                if (inclusion._flags.result === 'strip') {
                                    fastSplice(value, i)
                                    --i
                                    --il
                                } else if (!schema._flags.sparse &&
                                    res.value === undefined) {
                                    errors.push(error('array.sparse', {key, path, pos: i, value: undefined}, state.localize(path)))
                                    errored = true
                                } else {
                                    value[i] = res.value
                                }
                                isValid = true
                                break
                            }
                            localState.restore()
                        }
                        //Return the actual error if only one inclusion defined
                        if (jl === 1) {
                            if (stripUnknown) {
                                fastSplice(value, i)
                                --i
                                --il
                                isValid = true
                                break
                            }
                            errors.push(...(res.errors as ErrorItem[]))
                            if (prefs.abortEarly) return errors
                            errored = true
                            break
                        }
                    }
                    if (errored) continue
                    if ((schema.$_terms._inclusions.length || schema.$_terms._requireds.length) &&
                        !isValid) {
                        if (stripUnknown) {
                            fastSplice(value, i)
                            --i
                            --il
                            continue
                        }
                        errors.push(error('array.includes', {pos: i, value: item}, state.localize(path)))
                        if (prefs.abortEarly) return errors
                    }
                }
                if (requireds.length) fillMissedErrors(schema, errors, requireds, value, state, prefs)
                if (ordereds.length) {
                    fillOrderedErrors(schema, errors, ordereds, value, state, prefs)
                    if (!errors.length) fillDefault(ordereds, value, state, prefs)
                }
                return errors.length ? errors : value
            },

            priority: true,
            manifest: false
        },

        length: {
            method(this: ArraySchema, limit: unknown): ArraySchema {
                return this.$_addRule({name: 'length', args: {limit}, operator: '='})
            },
            validate(value: unknown, helpers: ValidationHelpers<ArraySchema>, {limit}: Record<string, unknown>, {name, operator, args}: SchemaRule): unknown {
                if (Common.compare((value as unknown[]).length, limit, operator as Common.CompareOperator)) return value
                return helpers.error('array.' + name, {limit: (args as Record<string, unknown>).limit, value})
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
            method(this: ArraySchema, limit: unknown): ArraySchema {
                return this.$_addRule({name: 'max', method: 'length', args: {limit}, operator: '<='})
            }
        },

        min: {
            method(this: ArraySchema, limit: unknown): ArraySchema {
                return this.$_addRule({name: 'min', method: 'length', args: {limit}, operator: '>='})
            }
        },

        ordered: {
            method(this: ArraySchema, ...schemas: unknown[]): ArraySchema {
                Common.verifyFlat(schemas, 'ordered')
                const obj: ArraySchema = this.$_addRule('items')
                for (let i: number = 0; i < schemas.length; ++i) {
                    const type: Base = Common.tryWithPath((): Base => this.$_compile(schemas[i]), i, {append: true})
                    validateSingle(type, obj)
                    obj.$_mutateRegister(type)
                    obj.$_terms.ordered.push(type)
                }
                return obj.$_mutateRebuild()
            }
        },

        single: {
            method(this: ArraySchema, enabled?: unknown): ArraySchema {
                const value: boolean = enabled === undefined ? true : !!enabled
                assert(!value || !this._flags._arrayItems, 'Cannot specify single rule when array has array items')
                return this.$_setFlag('single', value)
            }
        },

        sort: {
            method(this: ArraySchema, options: SortOptions = {}): ArraySchema {
                Common.assertOptions(options, ['by', 'order'])
                const settings: SortSettings = {
                    order: options.order || 'ascending'
                }
                if (options.by) {
                    settings.by = Compile.ref(options.by, {ancestor: 0})
                    assert(!settings.by.ancestor, 'Cannot sort by ancestor')
                }
                return this.$_addRule({name: 'sort', args: {options: settings}})
            },
            validate(input: unknown, {error, state, prefs, schema}: ValidationHelpers<ArraySchema>, args: Record<string, unknown>): unknown {
                const value: unknown[] = input as unknown[]
                const options: SortSettings = args.options as SortSettings
                const {value: sorted, errors} = sortArray(schema, value, options, state, prefs)
                if (errors) return errors
                for (let i: number = 0; i < value.length; ++i) {
                    if (value[i] !== (sorted as unknown[])[i]) {
                        return error('array.sort', {order: options.order, by: options.by ? options.by.key : 'value'})
                    }
                }
                return value
            },
            convert: true
        },

        sparse: {
            method(this: ArraySchema, enabled?: unknown): ArraySchema {
                const value: boolean = enabled === undefined ? true : !!enabled
                if (this._flags.sparse === value) return this
                const obj: ArraySchema = value ? this.clone() : this.$_addRule('items')
                return obj.$_setFlag('sparse', value, {clone: false})
            }
        },

        unique: {
            method(this: ArraySchema, comparator?: string | UniqueComparator, options: UniqueOptions = {}): ArraySchema {
                assert(!comparator || typeof comparator === 'function' || typeof comparator === 'string', 'comparator must be a function or a string')
                Common.assertOptions(options, ['ignoreUndefined', 'separator'])
                const rule: SchemaRuleOptions = {name: 'unique', args: {options, comparator}}
                if (comparator) {
                    if (typeof comparator === 'string') {
                        const separator: string | false = Common.defaultValue(options.separator, '.')
                        rule.path = separator ? comparator.split(separator) : [comparator]
                    } else {
                        rule.comparator = comparator
                    }
                }
                return this.$_addRule(rule)
            },
            validate(input: unknown, {state, error, schema}: ValidationHelpers<ArraySchema>, {comparator: raw, options}: Record<string, unknown>, rule: SchemaRule): unknown {
                const value: unknown[] = input as unknown[]
                const comparator: UniqueComparator | undefined = rule.comparator as UniqueComparator | undefined
                const path: string[] | undefined = rule.path as string[] | undefined
                const found: Record<string, Record<string, number> | Map<unknown, number>> = {
                    string: Object.create(null),
                    number: Object.create(null),
                    undefined: Object.create(null),
                    boolean: Object.create(null),
                    bigint: Object.create(null),
                    object: new Map(),
                    function: new Map(),
                    custom: new Map()
                }
                const compare: UniqueComparator = comparator || deepEqual
                const ignoreUndefined: boolean | undefined = (options as UniqueOptions).ignoreUndefined
                for (let i: number = 0; i < value.length; ++i) {
                    const item: unknown = path ? reach(value[i], path) : value[i]
                    const records: Record<string, number> | Map<unknown, number> = comparator ? found.custom : found[typeof item]
                    assert(records, 'Failed to find unique map container for type', typeof item)
                    if (records instanceof Map) {
                        const entries: IterableIterator<[unknown, number]> = records.entries()
                        let current: IteratorResult<[unknown, number]>
                        while (!(current = entries.next()).done) {
                            if (compare(current.value[0], item)) {
                                const localState: State = state.localize([...state.path, i], [value, ...state.ancestors])
                                const context: ReportLocal = {
                                    pos: i,
                                    value: value[i],
                                    dupePos: current.value[1],
                                    dupeValue: value[current.value[1]]
                                }
                                if (path) context.path = raw
                                return error('array.unique', context, localState)
                            }
                        }
                        records.set(item, i)
                    } else {
                        if ((!ignoreUndefined || item !== undefined) &&
                            records[item as string] !== undefined) {
                            const context: ReportLocal = {
                                pos: i,
                                value: value[i],
                                dupePos: records[item as string],
                                dupeValue: value[records[item as string]]
                            }
                            if (path) context.path = raw
                            const localState: State = state.localize([...state.path, i], [value, ...state.ancestors])
                            return error('array.unique', context, localState)
                        }
                        records[item as string] = i
                    }
                }
                return value
            },
            args: ['comparator', 'options'],
            multi: true
        }
    },

    overrides: {

        isAsync(this: ArraySchema): boolean {
            if (this.$_terms.externals?.length) return true
            for (const item of this.$_terms.items) {
                if (item.isAsync()) return true
            }
            for (const item of this.$_terms.ordered) {
                if (item.isAsync()) return true
            }
            return false
        }
    },

    cast: {
        set: {
            from: Array.isArray,
            to(value: unknown, helpers: ValidationHelpers<ArraySchema>): unknown {
                return new Set(value as unknown[])
            }
        }
    },

    rebuild(schema: ArraySchema): void {
        schema.$_terms._inclusions = []
        schema.$_terms._exclusions = []
        schema.$_terms._requireds = []
        for (const type of schema.$_terms.items) {
            validateSingle(type, schema)
            if (type._flags.presence === 'required') {
                schema.$_terms._requireds.push(type)
            } else if (type._flags.presence === 'forbidden') {
                schema.$_terms._exclusions.push(type)
            } else {
                schema.$_terms._inclusions.push(type)
            }
        }
        for (const type of schema.$_terms.ordered) validateSingle(type, schema)
    },

    manifest: {

        build(obj: ArraySchema, desc: Record<string, unknown>): ArraySchema {
            if (desc.items) obj = obj.items(...(desc.items as unknown[]))
            if (desc.ordered) obj = obj.ordered(...(desc.ordered as unknown[]))
            return obj
        }
    },

    messages: {
        'array.base': '{{#label}} must be an array',
        'array.excludes': '{{#label}} contains an excluded value',
        'array.hasKnown': '{{#label}} does not contain at least one required match for type {:#patternLabel}',
        'array.hasUnknown': '{{#label}} does not contain at least one required match',
        'array.includes': '{{#label}} does not match any of the allowed types',
        'array.includesRequiredBoth': '{{#label}} does not contain {{#knownMisses}} and {{#unknownMisses}} other required value(s)',
        'array.includesRequiredKnowns': '{{#label}} does not contain {{#knownMisses}}',
        'array.includesRequiredUnknowns': '{{#label}} does not contain {{#unknownMisses}} required value(s)',
        'array.length': '{{#label}} must contain {{#limit}} items',
        'array.max': '{{#label}} must contain less than or equal to {{#limit}} items',
        'array.min': '{{#label}} must contain at least {{#limit}} items',
        'array.orderedLength': '{{#label}} must contain at most {{#limit}} items',
        'array.sort': '{{#label}} must be sorted in {#order} order by {{#by}}',
        'array.sort.mismatching': '{{#label}} cannot be sorted due to mismatching types',
        'array.sort.unsupported': '{{#label}} cannot be sorted due to unsupported type {#type}',
        'array.sparse': '{{#label}} must not be a sparse array item',
        'array.unique': '{{#label}} contains a duplicate value'
    }
})

export default ArrayType

//Helpers

function fillMissedErrors(schema: ArraySchema, errors: ErrorItem[], requireds: Base[], value: unknown[], state: State, prefs: Preferences): void {
    const knownMisses: string[] = []
    let unknownMisses: number = 0
    for (const required of requireds) {
        const label: string | undefined = required._flags.label
        if (label) {
            knownMisses.push(label)
        } else {
            ++unknownMisses
        }
    }
    if (knownMisses.length) {
        if (unknownMisses) {
            errors.push(schema.$_createError('array.includesRequiredBoth', value, {knownMisses, unknownMisses}, state, prefs))
        } else {
            errors.push(schema.$_createError('array.includesRequiredKnowns', value, {knownMisses}, state, prefs))
        }
    } else {
        errors.push(schema.$_createError('array.includesRequiredUnknowns', value, {unknownMisses}, state, prefs))
    }
}

function fillOrderedErrors(schema: ArraySchema, errors: ErrorItem[], ordereds: Base[], value: unknown[], state: State, prefs: Preferences): void {
    const requiredOrdereds: Base[] = []
    for (const ordered of ordereds) {
        if (ordered._flags.presence === 'required') requiredOrdereds.push(ordered)
    }
    if (requiredOrdereds.length) fillMissedErrors(schema, errors, requiredOrdereds, value, state, prefs)
}

function fillDefault(ordereds: Base[], value: unknown[], state: State, prefs: Preferences): void {
    const overrides: unknown[] = []
    let trailingUndefined: boolean = true
    for (let i: number = ordereds.length - 1; i >= 0; --i) {
        const ordered: Base = ordereds[i]
        const ancestors: unknown[] = [value, ...state.ancestors]
        const override: unknown = ordered.$_validate(undefined, state.localize(state.path, ancestors, ordered), prefs).value
        if (trailingUndefined) {
            if (override === undefined) continue
            trailingUndefined = false
        }
        overrides.unshift(override)
    }
    if (overrides.length) value.push(...overrides)
}

function fastSplice(arr: unknown[], i: number): void {
    let pos: number = i
    while (pos < arr.length) arr[pos++] = arr[pos]
    --arr.length
}

function validateSingle(type: Base, obj: ArraySchema): void {
    if (type.type === 'array' ||
        type._flags._arrayItems) {
        assert(!obj._flags.single, 'Cannot specify array item with single rule enabled')
        obj.$_setFlag('_arrayItems', true, {clone: false})
    }
}

//Upstream: internals.sort()
function sortArray(schema: ArraySchema, value: unknown[], settings: SortSettings, state: State, prefs: Preferences): { value?: unknown[], errors?: ErrorItem } {
    const order: number = settings.order === 'ascending' ? 1 : -1
    const aFirst: number = -1 * order
    const bFirst: number = order
    const sort = (a: unknown, b: unknown): number => {
        let compare: number | null = compareNulls(a, b, aFirst, bFirst)
        if (compare !== null) return compare
        if (settings.by) {
            a = settings.by.resolve(a, state, prefs, undefined)
            b = settings.by.resolve(b, state, prefs, undefined)
        }
        compare = compareNulls(a, b, aFirst, bFirst)
        if (compare !== null) return compare
        const type: string = typeof a
        if (type !== typeof b) throw schema.$_createError('array.sort.mismatching', value, null, state, prefs)
        if (type !== 'number' &&
            type !== 'string') {
            throw schema.$_createError('array.sort.unsupported', value, {type}, state, prefs)
        }
        if (type === 'number') return ((a as number) - (b as number)) * order
        return (a as string) < (b as string) ? aFirst : bFirst
    }
    try {
        return {value: value.slice().sort(sort)}
    } catch (err) {
        return {errors: err as Report}
    }
}

//Upstream: internals.compare()
function compareNulls(a: unknown, b: unknown, aFirst: number, bFirst: number): number | null {
    if (a === b) return 0
    //Always last regardless of sort order
    if (a === undefined) return 1
    //Always last regardless of sort order
    if (b === undefined) return -1
    if (a === null) return bFirst
    if (b === null) return aFirst
    return null
}
