/**
 * Derived from the upstream lib/types/keys.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {applyToDefaults, clone as Clone} from '../../utils/index.js'
import {assert, definition} from '../assert.js'
import * as Sorting from '../../sorter/index.js'
import type {Base, DefaultOptions, SchemaTerms} from '../base.js'
import * as Common from '../common.js'
import * as Compile from '../compile.js'
import * as Errors from '../errors.js'
import type {PathKey, Preferences, SchemaRule, ValidationHelpers, ValidationOutcome} from '../model.js'
import * as Ref from '../ref.js'
import type {State} from '../state.js'
import {Template} from '../template.js'
import type {SchemaResult} from '../validator.js'
import Any, {type AnySchema, type AnyTerms} from './any.js'

/**
 * The value being validated, once shallow cloned (an object or a function)
 */
type KeysValue = Record<string, unknown>

/**
 * The relation of a dependency between keys
 */
export type DependencyRel = 'and' | 'nand' | 'or' | 'oxor' | 'with' | 'without' | 'xor'

/**
 * The options of a dependency (the optional last peer of and(), nand(), or(), oxor() and xor())
 */
export interface DependencyOptions {
    separator?: string | false
    isPresent?: (resolved: unknown) => unknown
}

/**
 * A peer of a dependency (or its options, when last)
 */
export type DependencyPeer = string | DependencyOptions

/**
 * The description of a dependency
 */
export interface DependencyDescription {
    rel: DependencyRel
    peers: string[]
    key?: string | null
    options?: DependencyOptions
}

/**
 * A child key of an object schema
 */
export interface KeysChild {
    key: string
    schema: Base
}

/**
 * An item of the patterns term
 */
export interface PatternTerm {
    regex?: RegExp
    schema?: Base
    rule: Base
    matches?: Base
    fallthrough?: boolean
}

export interface PatternOptions {
    fallthrough?: boolean
    matches?: unknown
}

export interface RenameOptions {
    //Keep old value in place
    alias?: boolean
    ignoreUndefined?: boolean
    //Allow renaming multiple keys into the same target
    multiple?: boolean
    //Overrides an existing key
    override?: boolean
}

/**
 * An item of the renames term
 */
export interface RenameTerm {
    from: string | RegExp
    to: string | Template
    options: RenameOptions
}

/**
 * A key matched by a rename
 */
interface RenameMatch {
    from: string | RegExp
    to: string | Template
    match?: RegExpExecArray
}

/**
 * A failed dependency
 */
interface DependencyFailure {
    code: string
    context: Errors.ReportLocal
}

type DependencyMethod = (schema: KeysSchema, dep: Dependency, value: KeysValue, state: State, prefs: Preferences) => DependencyFailure | undefined

/**
 * The subject of an assertion: a reference or a template, resolved without a local context
 */
type AssertSubject = { resolve(value: unknown, state: State, prefs: Preferences, local?: unknown): unknown }

/**
 * The root, as far as pattern matches use it
 */
type ArrayRoot = { array(): { items(schema: Base): Base } }

/**
 * The terms of the object-like schemas
 */
export interface KeysTerms {
    dependencies: Dependency[] | null
    keys: Keys | null
    patterns: PatternTerm[] | null
    renames: RenameTerm[] | null
}

/**
 * The base schema of the object and function types
 */
export interface KeysSchema extends AnySchema {
    $_terms: SchemaTerms & AnyTerms & KeysTerms
    and(...peers: DependencyPeer[]): this
    append(schema?: Record<string, unknown> | null): this
    assert(subject: unknown, schema: unknown, message?: string): this
    instance(constructor: Function, name?: string): this
    keyNames(schema: unknown): this
    keys(schema?: Record<string, unknown> | null): this
    length(limit: unknown): this
    max(limit: unknown): this
    min(limit: unknown): this
    nand(...peers: DependencyPeer[]): this
    or(...peers: DependencyPeer[]): this
    oxor(...peers: DependencyPeer[]): this
    pattern(pattern: unknown, schema: unknown, options?: PatternOptions): this
    ref(): this
    regex(): this
    rename(from: string | RegExp, to: string | Template, options?: RenameOptions): this
    schema(type?: string): this
    unknown(allow?: boolean | unknown): this
    with(key: string, peers: string | string[], options?: DependencyOptions): this
    without(key: string, peers: string | string[], options?: DependencyOptions): this
    xor(...peers: DependencyPeer[]): this
}

const renameDefaults: RenameOptions = {
    //Keep old value in place
    alias: false,
    //Allow renaming multiple keys into the same target
    multiple: false,
    //Overrides an existing key
    override: false
}

const KeysType: KeysSchema = Any.extend<KeysSchema>({

    type: '_keys',

    properties: {

        typeof: 'object'
    },

    flags: {

        unknown: {default: undefined}
    },

    terms: {

        dependencies: {init: null},
        keys: {init: null, manifest: {mapped: {from: 'schema', to: 'key'}}},
        patterns: {init: null},
        renames: {init: null}
    },

    args(schema: KeysSchema, keys?: Record<string, unknown> | null): KeysSchema {
        return schema.keys(keys)
    },

    validate(input: unknown, {schema, error, state, prefs}: ValidationHelpers<KeysSchema>): ValidationOutcome | undefined {
        if (!input ||
            typeof input !== schema.$_property('typeof') ||
            Array.isArray(input)) {
            return {value: input, errors: error('object.base', {type: schema.$_property('typeof')})}
        }
        //Skip if there are no other rules to test
        if (!schema.$_terms.renames &&
            !schema.$_terms.dependencies &&
            //null allows any keys
            !schema.$_terms.keys &&
            !schema.$_terms.patterns &&
            !schema.$_terms.externals &&
            //A schema for the unknown keys
            typeof schema._flags.unknown !== 'object') {
            return
        }
        //Shallow clone value
        const value: KeysValue = clone(input as object, prefs)
        const errors: Errors.ErrorItem[] = []
        //Rename keys
        if (schema.$_terms.renames &&
            !rename(schema, value, state, prefs, errors)) {
            return {value, errors}
        }
        //Anything allowed
        if (!schema.$_terms.keys &&
            //null allows any keys
            !schema.$_terms.patterns &&
            !schema.$_terms.dependencies &&
            typeof schema._flags.unknown !== 'object') {
            return {value, errors}
        }
        //Defined keys
        const unprocessed: Set<string> = new Set(Object.keys(value))
        if (schema.$_terms.keys) {
            const ancestors: unknown[] = [value, ...state.ancestors]
            for (const child of schema.$_terms.keys) {
                const key: string = child.key
                const item: unknown = value[key]
                unprocessed.delete(key)
                const localState: State = state.localize([...state.path, key], ancestors, child)
                const result: SchemaResult = child.schema.$_validate(item, localState, prefs)
                if (result.errors) {
                    if (prefs.abortEarly) return {value, errors: result.errors}
                    if (result.value !== undefined) value[key] = result.value
                    errors.push(...result.errors)
                } else if (child.schema._flags.result === 'strip' ||
                    result.value === undefined && item !== undefined) {
                    delete value[key]
                } else if (result.value !== undefined) {
                    value[key] = result.value
                }
            }
        }
        //Unknown keys
        if (unprocessed.size ||
            schema._flags._hasPatternMatch) {
            const early: ValidationOutcome | undefined = unknown(schema, value, unprocessed, errors, state, prefs)
            if (early) return early
        }
        //Validate dependencies
        if (schema.$_terms.dependencies) {
            for (const dep of schema.$_terms.dependencies) {
                if (
                    dep.key !== null &&
                    isPresent(dep.options)(dep.key.resolve(value, state, prefs, null, {shadow: false})) === false
                ) {
                    continue
                }
                const failed: DependencyFailure | undefined = dependencies[dep.rel](schema, dep, value, state, prefs)
                if (failed) {
                    const report: Errors.Report = schema.$_createError(failed.code, value, failed.context, state, prefs)
                    if (prefs.abortEarly) return {value, errors: report}
                    errors.push(report)
                }
            }
        }
        return {value, errors}
    },

    rules: {

        and: {
            method(this: KeysSchema, ...peers: DependencyPeer[]): KeysSchema {
                Common.verifyFlat(peers, 'and')
                return dependency(this, 'and', null, peers)
            }
        },

        append: {
            method(this: KeysSchema, schema?: Record<string, unknown> | null): KeysSchema {
                if (schema === null ||
                    schema === undefined ||
                    Object.keys(schema).length === 0) {
                    return this
                }
                return this.keys(schema)
            }
        },

        assert: {
            method(this: KeysSchema, subject: unknown, schema: unknown, message?: string): KeysSchema {
                if (!Template.isTemplate(subject)) subject = Compile.ref(subject)
                assert(message === undefined || typeof message === 'string', 'Message must be a string')
                schema = this.$_compile(schema, {appendPath: true})
                const obj: KeysSchema = this.$_addRule({name: 'assert', args: {subject, schema, message}})
                obj.$_mutateRegister(subject)
                obj.$_mutateRegister(schema)
                return obj
            },
            validate(value: unknown, {error, prefs, state}: ValidationHelpers<KeysSchema>, {subject, schema, message}: Record<string, unknown>): unknown {
                const about: unknown = (subject as AssertSubject).resolve(value, state, prefs)
                const path: PathKey[] = Ref.isRef(subject) ? subject.absolute(state) : []
                if ((schema as Base).$_match(about, state.localize(path, [value, ...state.ancestors], schema), prefs)) return value
                return error('object.assert', {subject, message})
            },
            args: ['subject', 'schema', 'message'],
            multi: true
        },

        instance: {
            method(this: KeysSchema, constructor: Function, name?: string): KeysSchema {
                assert(typeof constructor === 'function', 'constructor must be a function')
                name = name || constructor.name
                return this.$_addRule({name: 'instance', args: {constructor, name}})
            },
            validate(value: unknown, helpers: ValidationHelpers<KeysSchema>, {constructor, name}: Record<string, unknown>): unknown {
                if (value instanceof (constructor as Function)) return value
                return helpers.error('object.instance', {type: name, value})
            },
            args: ['constructor', 'name']
        },

        keyNames: {
            method(this: KeysSchema, schema: unknown): KeysSchema {
                //lakutata's own: every key name must match the schema
                schema = this.$_compile(schema)
                const obj: KeysSchema = this.$_addRule({name: 'keyNames', args: {schema}})
                obj.$_mutateRegister(schema)
                return obj
            },
            validate(value: unknown, {state, prefs, error}: ValidationHelpers<KeysSchema>, {schema}: Record<string, unknown>): unknown {
                const names: Base = schema as Base
                const ancestors: unknown[] = [value, ...state.ancestors]
                for (const name of Object.keys(value as object)) {
                    const localState: State = state.localize([...state.path, name], ancestors, names)
                    if (!names.$_match(name, localState, prefs)) return error('object.keyNames', {name})
                }
                return value
            },
            args: ['schema']
        },

        keys: {
            method(this: KeysSchema, schema?: Record<string, unknown> | null): KeysSchema {
                assert(schema === undefined || typeof schema === 'object', 'Object schema must be a valid object')
                assert(!Common.isSchema(schema), 'Object schema cannot be a schema object')
                const obj: KeysSchema = this.clone()
                if (!schema) {
                    //Allow all
                    obj.$_terms.keys = null
                } else if (!Object.keys(schema).length) {
                    //Allow none
                    obj.$_terms.keys = new Keys()
                } else {
                    obj.$_terms.keys = obj.$_terms.keys ? obj.$_terms.keys.filter((child: KeysChild): boolean => !Object.hasOwn(schema, child.key)) as Keys : new Keys()
                    for (const key in schema) {
                        Common.tryWithPath((): number => (obj.$_terms.keys as Keys).push({key, schema: this.$_compile(schema[key])}), key)
                    }
                }
                return obj.$_mutateRebuild()
            }
        },

        length: {
            method(this: KeysSchema, limit: unknown): KeysSchema {
                return this.$_addRule({name: 'length', args: {limit}, operator: '='})
            },
            validate(value: unknown, helpers: ValidationHelpers<KeysSchema>, {limit}: Record<string, unknown>, {name, operator, args}: SchemaRule): unknown {
                if (Common.compare(Object.keys(value as object).length, limit, operator as Common.CompareOperator)) return value
                return helpers.error('object.' + name, {limit: (args as Record<string, unknown>).limit, value})
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
            method(this: KeysSchema, limit: unknown): KeysSchema {
                return this.$_addRule({name: 'max', method: 'length', args: {limit}, operator: '<='})
            }
        },

        min: {
            method(this: KeysSchema, limit: unknown): KeysSchema {
                return this.$_addRule({name: 'min', method: 'length', args: {limit}, operator: '>='})
            }
        },

        nand: {
            method(this: KeysSchema, ...peers: DependencyPeer[]): KeysSchema {
                Common.verifyFlat(peers, 'nand')
                return dependency(this, 'nand', null, peers)
            }
        },

        or: {
            method(this: KeysSchema, ...peers: DependencyPeer[]): KeysSchema {
                Common.verifyFlat(peers, 'or')
                return dependency(this, 'or', null, peers)
            }
        },

        oxor: {
            method(this: KeysSchema, ...peers: DependencyPeer[]): KeysSchema {
                return dependency(this, 'oxor', null, peers)
            }
        },

        pattern: {
            method(this: KeysSchema, pattern: unknown, schema: unknown, options: PatternOptions = {}): KeysSchema {
                const isRegExp: boolean = pattern instanceof RegExp
                if (!isRegExp) pattern = this.$_compile(pattern, {appendPath: true})
                assert(schema !== undefined, 'Invalid rule')
                Common.assertOptions(options, ['fallthrough', 'matches'])
                if (isRegExp) assert(!(pattern as RegExp).flags.includes('g') && !(pattern as RegExp).flags.includes('y'), 'pattern should not use global or sticky mode')
                schema = this.$_compile(schema, {appendPath: true})
                const obj: KeysSchema = this.clone()
                obj.$_terms.patterns = obj.$_terms.patterns || []
                const config: PatternTerm = {[isRegExp ? 'regex' : 'schema']: pattern, rule: schema} as PatternTerm
                if (options.matches) {
                    config.matches = this.$_compile(options.matches)
                    if (config.matches.type !== 'array') config.matches = (config.matches.$_root as unknown as ArrayRoot).array().items(config.matches)
                    obj.$_mutateRegister(config.matches)
                    obj.$_setFlag('_hasPatternMatch', true, {clone: false})
                }
                if (options.fallthrough) config.fallthrough = true
                obj.$_terms.patterns.push(config)
                obj.$_mutateRegister(schema)
                return obj
            }
        },

        ref: {
            method(this: KeysSchema): KeysSchema {
                return this.$_addRule('ref')
            },
            validate(value: unknown, helpers: ValidationHelpers<KeysSchema>): unknown {
                if (Ref.isRef(value)) return value
                return helpers.error('object.refType', {value})
            }
        },

        regex: {
            method(this: KeysSchema): KeysSchema {
                return this.$_addRule('regex')
            },
            validate(value: unknown, helpers: ValidationHelpers<KeysSchema>): unknown {
                if (value instanceof RegExp) return value
                return helpers.error('object.regex', {value})
            }
        },

        rename: {
            method(this: KeysSchema, from: string | RegExp, to: string | Template, options: RenameOptions = {}): KeysSchema {
                assert(typeof from === 'string' || from instanceof RegExp, 'Rename missing the from argument')
                assert(typeof to === 'string' || to instanceof Template, 'Invalid rename to argument')
                assert(to !== from, 'Cannot rename key to same name:', from)
                Common.assertOptions(options, ['alias', 'ignoreUndefined', 'override', 'multiple'])
                const obj: KeysSchema = this.clone()
                obj.$_terms.renames = obj.$_terms.renames || []
                for (const rename of obj.$_terms.renames) assert(rename.from !== from, 'Cannot rename the same key multiple times')
                if (to instanceof Template) obj.$_mutateRegister(to)
                obj.$_terms.renames.push({
                    from,
                    to,
                    options: applyToDefaults(renameDefaults, options) as RenameOptions
                })
                return obj
            }
        },

        schema: {
            method(this: KeysSchema, type: string = 'any'): KeysSchema {
                return this.$_addRule({name: 'schema', args: {type}})
            },
            validate(value: unknown, helpers: ValidationHelpers<KeysSchema>, {type}: Record<string, unknown>): unknown {
                if (Common.isSchema(value) &&
                    (type === 'any' || (value as unknown as Base).type === type)) {
                    return value
                }
                return helpers.error('object.schema', {type})
            }
        },

        unknown: {
            method(this: KeysSchema, allow?: boolean | unknown): KeysSchema {
                if (allow === undefined || allow === null || typeof allow === 'boolean') return this.$_setFlag('unknown', allow !== false)
                //lakutata's own: the unknown keys are allowed and must match the schema
                const obj: KeysSchema = this.clone()
                const schema: Base = obj.$_compile(allow)
                obj.$_mutateRegister(schema)
                return obj.$_setFlag('unknown', schema, {clone: false})
            }
        },

        with: {
            method(this: KeysSchema, key: string, peers: string | string[], options: DependencyOptions = {}): KeysSchema {
                return dependency(this, 'with', key, peers, options)
            }
        },

        without: {
            method(this: KeysSchema, key: string, peers: string | string[], options: DependencyOptions = {}): KeysSchema {
                return dependency(this, 'without', key, peers, options)
            }
        },

        xor: {
            method(this: KeysSchema, ...peers: DependencyPeer[]): KeysSchema {
                Common.verifyFlat(peers, 'xor')
                return dependency(this, 'xor', null, peers)
            }
        }
    },

    overrides: {

        default(this: KeysSchema, value?: unknown, options?: DefaultOptions): unknown {
            if (value === undefined) value = Common.symbols.deepDefault
            return this.$_parent('default', value, options)
        },

        isAsync(this: KeysSchema): boolean {
            if (this.$_terms.externals?.length) return true
            if (typeof this._flags.unknown === 'object' && (this._flags.unknown as Base).isAsync()) return true
            if (this.$_terms.keys?.length) {
                for (const key of this.$_terms.keys) {
                    if (key.schema.isAsync()) return true
                }
            }
            if (this.$_terms.patterns?.length) {
                for (const pattern of this.$_terms.patterns) {
                    if (pattern.rule.isAsync()) return true
                }
            }
            return false
        }
    },

    rebuild(schema: KeysSchema): void {
        if (schema.$_terms.keys) {
            const sorter: Sorting.Sorter<KeysChild> = new Sorting.Sorter()
            for (const child of schema.$_terms.keys) {
                Common.tryWithPath((): KeysChild[] => definition((): KeysChild[] => sorter.add(child, {after: child.schema.$_rootReferences() as string[], group: child.key})), child.key)
            }
            schema.$_terms.keys = new Keys(...sorter.nodes)
        }
    },

    manifest: {

        build(obj: KeysSchema, desc: Record<string, unknown>): KeysSchema {
            if (desc.keys) obj = obj.keys(desc.keys as Record<string, unknown>)
            if (desc.dependencies) {
                for (const {rel, key = null, peers, options} of desc.dependencies as DependencyDescription[]) obj = dependency(obj, rel, key, peers, options)
            }
            if (desc.patterns) {
                for (const {regex, schema, rule, fallthrough, matches} of desc.patterns as PatternTerm[]) obj = obj.pattern(regex || schema, rule, {fallthrough, matches})
            }
            if (desc.renames) {
                for (const {from, to, options} of desc.renames as RenameTerm[]) obj = obj.rename(from, to, options)
            }
            return obj
        }
    },

    messages: {
        'object.and': '{{#label}} contains {{#presentWithLabels}} without its required peers {{#missingWithLabels}}',
        'object.assert': '{{#label}} is invalid because {if(#subject.key, `"` + #subject.key + `" failed to ` + (#message || "pass the assertion test"), #message || "the assertion failed")}',
        'object.base': '{{#label}} must be of type {{#type}}',
        'object.instance': '{{#label}} must be an instance of {{:#type}}',
        'object.keyNames': '{{#label}} has a key name "{{#name}}" which is not allowed',
        'object.length': '{{#label}} must have {{#limit}} key{if(#limit == 1, "", "s")}',
        'object.max': '{{#label}} must have less than or equal to {{#limit}} key{if(#limit == 1, "", "s")}',
        'object.min': '{{#label}} must have at least {{#limit}} key{if(#limit == 1, "", "s")}',
        'object.missing': '{{#label}} must contain at least one of {{#peersWithLabels}}',
        'object.nand': '{{:#mainWithLabel}} must not exist simultaneously with {{#peersWithLabels}}',
        'object.oxor': '{{#label}} contains a conflict between optional exclusive peers {{#peersWithLabels}}',
        'object.pattern.match': '{{#label}} keys failed to match pattern requirements',
        'object.refType': '{{#label}} must be a reference',
        'object.regex': '{{#label}} must be a RegExp object',
        'object.rename.multiple': '{{#label}} cannot rename {{:#from}} because multiple renames are disabled and another key was already renamed to {{:#to}}',
        'object.rename.override': '{{#label}} cannot rename {{:#from}} because override is disabled and target {{:#to}} exists',
        'object.schema': '{{#label}} must be a schema of {{#type}} type',
        'object.unknown': '{{#label}} is not allowed',
        'object.with': '{{:#mainWithLabel}} missing required peer {{:#peerWithLabel}}',
        'object.without': '{{:#mainWithLabel}} conflict with forbidden peer {{:#peerWithLabel}}',
        'object.xor': '{{#label}} contains a conflict between exclusive peers {{#peersWithLabels}}'
    }
})

export default KeysType

//Helpers

/**
 * Shallow clone the validated object or function
 * @param value
 * @param prefs
 */
function clone(value: object, prefs: Preferences): KeysValue {
    //Object
    if (typeof value === 'object') {
        if (prefs.nonEnumerables) return Clone(value, {shallow: true}) as KeysValue
        const clone: KeysValue = Object.create(Object.getPrototypeOf(value))
        Object.assign(clone, value)
        return clone
    }
    //Function
    const fn: Function = value as Function
    const clone = function (this: unknown, ...args: unknown[]): unknown {
        return fn.apply(this, args)
    }
    clone.prototype = Clone(fn.prototype)
    Object.defineProperty(clone, 'name', {value: fn.name, writable: false})
    Object.defineProperty(clone, 'length', {value: fn.length, writable: false})
    Object.assign(clone, value)
    return clone as unknown as KeysValue
}

/**
 * Add a dependency between keys
 * @param schema
 * @param rel
 * @param key
 * @param peers
 * @param options
 */
function dependency(schema: KeysSchema, rel: DependencyRel, key: string | Ref.Ref | null, peers: string | DependencyPeer[], options?: DependencyOptions): KeysSchema {
    assert(key === null || typeof key === 'string', rel, 'key must be a strings')
    //Extract options from peers array
    if (!options) options = peers.length > 1 && typeof peers[peers.length - 1] === 'object' ? (peers as DependencyPeer[]).pop() as DependencyOptions : {}
    Common.assertOptions(options, ['separator', 'isPresent'])
    peers = ([] as DependencyPeer[]).concat(peers)
    //Cast peer paths
    const separator: string | false = Common.defaultValue(options.separator, '.')
    const paths: Ref.Ref[] = []
    for (const peer of peers) {
        assert(typeof peer === 'string', rel, 'peers must be strings')
        paths.push(Compile.ref(peer, {separator, ancestor: 0, prefix: false}))
    }
    //Cast key
    if (key !== null) key = Compile.ref(key, {separator, ancestor: 0, prefix: false})
    //Add rule
    const obj: KeysSchema = schema.clone()
    obj.$_terms.dependencies = obj.$_terms.dependencies || []
    obj.$_terms.dependencies.push(new Dependency(rel, key, paths, peers as string[], options))
    return obj
}

const dependencies: Record<DependencyRel, DependencyMethod> = {

    and(schema: KeysSchema, dep: Dependency, value: KeysValue, state: State, prefs: Preferences): DependencyFailure | undefined {
        const missing: (string | null)[] = []
        const present: (string | null)[] = []
        const count: number = dep.peers.length
        const isPresentFn: (resolved: unknown) => unknown = isPresent(dep.options)
        for (const peer of dep.peers) {
            if (isPresentFn(peer.resolve(value, state, prefs, null, {shadow: false})) === false) {
                missing.push(peer.key)
            } else {
                present.push(peer.key)
            }
        }
        if (missing.length !== count &&
            present.length !== count) {
            return {
                code: 'object.and',
                context: {
                    present,
                    presentWithLabels: keysToLabels(schema, present),
                    missing,
                    missingWithLabels: keysToLabels(schema, missing)
                }
            }
        }
    },

    nand(schema: KeysSchema, dep: Dependency, value: KeysValue, state: State, prefs: Preferences): DependencyFailure | undefined {
        const present: (string | null)[] = []
        const isPresentFn: (resolved: unknown) => unknown = isPresent(dep.options)
        for (const peer of dep.peers) {
            if (isPresentFn(peer.resolve(value, state, prefs, null, {shadow: false}))) present.push(peer.key)
        }
        if (present.length !== dep.peers.length) return
        const main: string = dep.paths[0]
        const values: string[] = dep.paths.slice(1)
        return {
            code: 'object.nand',
            context: {
                main,
                mainWithLabel: keysToLabels(schema, main),
                peers: values,
                peersWithLabels: keysToLabels(schema, values)
            }
        }
    },

    or(schema: KeysSchema, dep: Dependency, value: KeysValue, state: State, prefs: Preferences): DependencyFailure | undefined {
        const isPresentFn: (resolved: unknown) => unknown = isPresent(dep.options)
        for (const peer of dep.peers) {
            if (isPresentFn(peer.resolve(value, state, prefs, null, {shadow: false}))) return
        }
        return {
            code: 'object.missing',
            context: {
                peers: dep.paths,
                peersWithLabels: keysToLabels(schema, dep.paths)
            }
        }
    },

    oxor(schema: KeysSchema, dep: Dependency, value: KeysValue, state: State, prefs: Preferences): DependencyFailure | undefined {
        const present: (string | null)[] = []
        const isPresentFn: (resolved: unknown) => unknown = isPresent(dep.options)
        for (const peer of dep.peers) {
            if (isPresentFn(peer.resolve(value, state, prefs, null, {shadow: false}))) present.push(peer.key)
        }
        if (!present.length ||
            present.length === 1) {
            return
        }
        const context: Errors.ReportLocal = {peers: dep.paths, peersWithLabels: keysToLabels(schema, dep.paths)}
        context.present = present
        context.presentWithLabels = keysToLabels(schema, present)
        return {code: 'object.oxor', context}
    },

    with(schema: KeysSchema, dep: Dependency, value: KeysValue, state: State, prefs: Preferences): DependencyFailure | undefined {
        const isPresentFn: (resolved: unknown) => unknown = isPresent(dep.options)
        for (const peer of dep.peers) {
            if (isPresentFn(peer.resolve(value, state, prefs, null, {shadow: false})) === false) {
                return {
                    code: 'object.with',
                    context: {
                        main: (dep.key as Ref.Ref).key,
                        mainWithLabel: keysToLabels(schema, (dep.key as Ref.Ref).key),
                        peer: peer.key,
                        peerWithLabel: keysToLabels(schema, peer.key)
                    }
                }
            }
        }
    },

    without(schema: KeysSchema, dep: Dependency, value: KeysValue, state: State, prefs: Preferences): DependencyFailure | undefined {
        const isPresentFn: (resolved: unknown) => unknown = isPresent(dep.options)
        for (const peer of dep.peers) {
            if (isPresentFn(peer.resolve(value, state, prefs, null, {shadow: false}))) {
                return {
                    code: 'object.without',
                    context: {
                        main: (dep.key as Ref.Ref).key,
                        mainWithLabel: keysToLabels(schema, (dep.key as Ref.Ref).key),
                        peer: peer.key,
                        peerWithLabel: keysToLabels(schema, peer.key)
                    }
                }
            }
        }
    },

    xor(schema: KeysSchema, dep: Dependency, value: KeysValue, state: State, prefs: Preferences): DependencyFailure | undefined {
        const present: (string | null)[] = []
        const isPresentFn: (resolved: unknown) => unknown = isPresent(dep.options)
        for (const peer of dep.peers) {
            if (isPresentFn(peer.resolve(value, state, prefs, null, {shadow: false}))) present.push(peer.key)
        }
        if (present.length === 1) return
        const context: Errors.ReportLocal = {peers: dep.paths, peersWithLabels: keysToLabels(schema, dep.paths)}
        if (present.length === 0) return {code: 'object.missing', context}
        context.present = present
        context.presentWithLabels = keysToLabels(schema, present)
        return {code: 'object.xor', context}
    }
}

/**
 * The labels of keys (a key, or an array of keys)
 * @param schema
 * @param keys
 */
function keysToLabels(schema: KeysSchema, keys: string | null | (string | null)[]): string | string[] {
    if (Array.isArray(keys)) return keys.map((key: string | null): string => schema.$_mapLabels(key as string))
    return schema.$_mapLabels(keys as string)
}

/**
 * The presence check of a dependency
 * @param options
 */
function isPresent(options: DependencyOptions): (resolved: unknown) => unknown {
    return typeof options.isPresent === 'function' ? options.isPresent : (resolved: unknown): boolean => resolved !== undefined
}

/**
 * Rename the keys of the (cloned) value, returning false to abort early
 * @param schema
 * @param value
 * @param state
 * @param prefs
 * @param errors
 */
function rename(schema: KeysSchema, value: KeysValue, state: State, prefs: Preferences, errors: Errors.ErrorItem[]): boolean {
    const renamed: Record<string, boolean> = {}
    for (const rename of schema.$_terms.renames as RenameTerm[]) {
        const matches: RenameMatch[] = []
        const pattern: boolean = typeof rename.from !== 'string'
        if (!pattern) {
            if (Object.prototype.hasOwnProperty.call(value, rename.from as string) &&
                (value[rename.from as string] !== undefined || !rename.options.ignoreUndefined)) {
                matches.push(rename)
            }
        } else {
            for (const from in value) {
                if (value[from] === undefined &&
                    rename.options.ignoreUndefined) {
                    continue
                }
                if (from === rename.to) continue
                const match: RegExpExecArray | null = (rename.from as RegExp).exec(from)
                if (!match) continue
                matches.push({from, to: rename.to, match})
            }
        }
        for (const match of matches) {
            const from: string = match.from as string
            let to: string | Template = match.to
            if (to instanceof Template) to = to.render(value, state, prefs, match.match)
            if (from === to) continue
            if (!rename.options.multiple &&
                renamed[to]) {
                errors.push(schema.$_createError('object.rename.multiple', value, {from, to, pattern}, state, prefs))
                if (prefs.abortEarly) return false
            }
            if (Object.prototype.hasOwnProperty.call(value, to) &&
                !rename.options.override &&
                !renamed[to]) {
                errors.push(schema.$_createError('object.rename.override', value, {from, to, pattern}, state, prefs))
                if (prefs.abortEarly) return false
            }
            if (value[from] === undefined) {
                delete value[to]
            } else {
                value[to] = value[from]
            }
            renamed[to] = true
            if (!rename.options.alias) delete value[from]
        }
    }
    return true
}

/**
 * Validate the unprocessed keys against the patterns, then strip or forbid the unknown keys
 * @param schema
 * @param value
 * @param unprocessed
 * @param errors
 * @param state
 * @param prefs
 */
function unknown(schema: KeysSchema, value: KeysValue, unprocessed: Set<string>, errors: Errors.ErrorItem[], state: State, prefs: Preferences): ValidationOutcome | undefined {
    if (schema.$_terms.patterns) {
        let hasMatches: boolean = false
        const matches: (string[] | undefined)[] = schema.$_terms.patterns.map((pattern: PatternTerm): string[] | undefined => {
            if (pattern.matches) {
                hasMatches = true
                return []
            }
        })
        const ancestors: unknown[] = [value, ...state.ancestors]
        for (const key of unprocessed) {
            const item: unknown = value[key]
            const path: PathKey[] = [...state.path, key]
            for (let i: number = 0; i < schema.$_terms.patterns.length; ++i) {
                const pattern: PatternTerm = schema.$_terms.patterns[i]
                if (pattern.regex) {
                    const match: boolean = pattern.regex.test(key)
                    state.mainstay.tracer.debug(state, 'rule', `pattern.${i}`, match ? 'pass' : 'error')
                    if (!match) continue
                } else {
                    if (!(pattern.schema as Base).$_match(key, state.nest(pattern.schema, `pattern.${i}`), prefs)) continue
                }
                unprocessed.delete(key)
                const localState: State = state.localize(path, ancestors, {schema: pattern.rule, key})
                const result: SchemaResult = pattern.rule.$_validate(item, localState, prefs)
                if (result.errors) {
                    if (prefs.abortEarly) return {value, errors: result.errors}
                    errors.push(...result.errors)
                }
                if (pattern.matches) (matches[i] as string[]).push(key)
                value[key] = result.value
                if (!pattern.fallthrough) break
            }
        }
        //Validate pattern matches rules
        if (hasMatches) {
            for (let i: number = 0; i < matches.length; ++i) {
                const match: string[] | undefined = matches[i]
                if (!match) continue
                const stpm: Base = schema.$_terms.patterns[i].matches as Base
                const localState: State = state.localize(state.path, ancestors, stpm)
                const result: SchemaResult = stpm.$_validate(match, localState, prefs)
                if (result.errors) {
                    const details: Errors.ErrorsDetails & Errors.ReportLocal = Errors.details(result.errors, {override: false}) as Errors.ErrorsDetails & Errors.ReportLocal
                    details.matches = match
                    const report: Errors.Report = schema.$_createError('object.pattern.match', value, details, state, prefs)
                    if (prefs.abortEarly) return {value, errors: report}
                    errors.push(report)
                }
            }
        }
    }
    //A schema for the unknown keys (lakutata's own)
    const unknownSchema: unknown = schema._flags.unknown
    if (typeof unknownSchema === 'object') {
        const ancestors: unknown[] = [value, ...state.ancestors]
        for (const key of unprocessed) {
            const localState: State = state.localize([...state.path, key], ancestors, {schema: unknownSchema as Base, key})
            const result: SchemaResult = (unknownSchema as Base).$_validate(value[key], localState, prefs)
            if (result.errors) {
                if (prefs.abortEarly) return {value, errors: result.errors}
                errors.push(...result.errors)
            }
            value[key] = result.value
        }
        return
    }
    //If no keys or patterns specified, unknown keys allowed
    if (!unprocessed.size ||
        !schema.$_terms.keys && !schema.$_terms.patterns) {
        return
    }
    if (prefs.stripUnknown && typeof schema._flags.unknown === 'undefined' ||
        prefs.skipFunctions) {
        const stripUnknown: boolean = prefs.stripUnknown ? (prefs.stripUnknown === true ? true : !!prefs.stripUnknown.objects) : false
        for (const key of unprocessed) {
            if (stripUnknown) {
                delete value[key]
                unprocessed.delete(key)
            } else if (typeof value[key] === 'function') {
                unprocessed.delete(key)
            }
        }
    }
    const forbidUnknown: boolean = !Common.defaultValue(schema._flags.unknown, prefs.allowUnknown)
    if (forbidUnknown) {
        for (const unprocessedKey of unprocessed) {
            const localState: State = state.localize([...state.path, unprocessedKey], [])
            const report: Errors.Report = schema.$_createError('object.unknown', value[unprocessedKey], {child: unprocessedKey}, localState, prefs, {flags: false})
            if (prefs.abortEarly) return {value, errors: report}
            errors.push(report)
        }
    }
}

/**
 * An item of the dependencies term
 */
class Dependency {

    public rel: DependencyRel

    public key: Ref.Ref | null

    //Like upstream, created with the arguments (rel, key, paths, peers, options): peers are the references and paths the peer strings
    public peers: Ref.Ref[]

    public paths: string[]

    public options: DependencyOptions

    constructor(rel: DependencyRel, key: Ref.Ref | null, peers: Ref.Ref[], paths: string[], options: DependencyOptions) {
        this.rel = rel
        this.key = key
        this.peers = peers
        this.paths = paths
        this.options = options
    }

    public describe(): DependencyDescription {
        const desc: DependencyDescription = {
            rel: this.rel,
            peers: this.paths
        }
        if (this.key !== null) desc.key = this.key.key
        if (this.peers[0].separator !== '.') desc.options = {...desc.options, separator: this.peers[0].separator}
        if (this.options.isPresent) desc.options = {...desc.options, isPresent: this.options.isPresent}
        return desc
    }
}

/**
 * The keys term: an array of children which concatenates by key
 */
class Keys extends Array<KeysChild> {

    public concat(source: KeysChild[]): KeysChild[] {
        const result: KeysChild[] = this.slice()
        const keys: Map<string, number> = new Map()
        for (let i: number = 0; i < result.length; ++i) keys.set(result[i].key, i)
        for (const item of source) {
            const key: string = item.key
            const pos: number | undefined = keys.get(key)
            if (pos !== undefined) {
                result[pos] = {key, schema: result[pos].schema.concat(item.schema)}
            } else {
                result.push(item)
            }
        }
        return result
    }
}
