import {Schema} from '../types/Schema.js'
import {SchemaLike} from '../types/SchemaLike.js'
import {LanguageMessages} from '../types/LanguageMessages.js'
import {ExtensionBoundSchema} from '../types/ExtensionBoundSchema.js'
import {AnySchema} from './AnySchema.js'
import {CustomHelpers} from './CustomHelpers.js'
import {ErrorReport} from './ErrorReport.js'
import {ExtensionFlag} from './ExtensionFlag.js'
import {SchemaInternals} from './SchemaInternals.js'

export interface RuleArgs {
    name: string
    ref?: boolean
    assert?: ((value: any) => boolean) | AnySchema
    message?: string

    /**
     * Undocumented properties
     */
    normalize?(value: any): any
}

export type RuleMethod = (...args: any[]) => any

export interface ExtensionRule {
    /**
     * alternative name for this rule.
     */
    alias?: string
    /**
     * whether rule supports multiple invocations.
     */
    multi?: boolean
    /**
     * Dual rule: converts or validates.
     */
    convert?: boolean
    /**
     * list of arguments accepted by `method`.
     */
    args?: Array<RuleArgs | string>
    /**
     * rule body.
     */
    method?: RuleMethod | false

    /**
     * validation function.
     */
    validate?(value: any, helpers: any, args: Record<string, any>, options: any): any

    /**
     * undocumented flags.
     */
    priority?: boolean
    manifest?: boolean
}

export interface CoerceResult {
    errors?: ErrorReport[]
    value?: any
}

export type CoerceFunction = (value: any, helpers: CustomHelpers) => CoerceResult

export interface CoerceObject {
    method: CoerceFunction
    from?: string | string[]
}

export interface ExtensionTermManifest {
    mapped: {
        from: string
        to: string
    }
}

export interface ExtensionTerm {
    init: any[] | null
    register?: any
    manifest?: Record<string, 'schema' | 'single' | ExtensionTermManifest>
}

/**
 * A validation extension: a new type, or an existing type extended
 */
export interface Extension {
    type: string | RegExp

    args?(...args: SchemaLike[]): Schema

    base?: Schema
    coerce?: CoerceFunction | CoerceObject
    flags?: Record<string, ExtensionFlag>
    manifest?: {
        build?(obj: ExtensionBoundSchema, desc: Record<string, any>): any
    }
    messages?: LanguageMessages | string
    modifiers?: Record<string, (rule: any, enabled?: boolean) => any>
    overrides?: Record<string, (value: any) => Schema>

    prepare?(value: any, helpers: CustomHelpers): any

    rebuild?(schema: ExtensionBoundSchema): void

    rules?: Record<string, ExtensionRule & ThisType<SchemaInternals>>
    terms?: Record<string, ExtensionTerm>

    validate?(value: any, helpers: CustomHelpers): any

    /**
     * undocumented options
     */
    cast?: Record<string, { from(value: any): any, to(value: any, helpers: CustomHelpers): any }>
    properties?: Record<string, any>
}
