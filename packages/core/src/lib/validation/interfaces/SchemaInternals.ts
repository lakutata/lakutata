import {Schema} from '../types/Schema.js'
import {SchemaLike} from '../types/SchemaLike.js'
import {LanguageMessages} from '../types/LanguageMessages.js'
import {CompileOptions} from './CompileOptions.js'
import {Context} from './Context.js'
import {State} from './State.js'
import {ValidationOptions} from './ValidationOptions.js'

export interface AddRuleOptions {
    name: string
    args?: {
        [key: string]: any
    }
}

export interface GetRuleOptions {
    args?: Record<string, any>
    method?: string
    name: string
    operator?: string
}

export interface CreateErrorOptions {
    flags?: boolean
    messages?: LanguageMessages
}

export interface Err {
    toString(): string
}

export interface ModifyOptions {
    each?: boolean
    once?: boolean
    ref?: boolean
    schema?: boolean
}

export interface MutateRegisterOptions {
    family?: any
    key?: any
}

export interface SetFlagOptions {
    clone: boolean
}

/**
 * The schema internals available to extensions
 */
export interface SchemaInternals {
    /**
     * Parent schema object.
     */
    $_super: Schema

    /**
     * Terms of current schema.
     */
    $_terms: Record<string, any>

    /**
     * Adds a rule to current validation schema.
     */
    $_addRule(rule: string | AddRuleOptions): Schema

    /**
     * Internally compiles schema.
     */
    $_compile(schema: SchemaLike, options?: CompileOptions): Schema

    /**
     * Creates a validation error object.
     */
    $_createError(code: string, value: any, context: Context, state: State, prefs: ValidationOptions, options?: CreateErrorOptions): Err

    /**
     * Get value from given flag.
     */
    $_getFlag(name: string): any

    /**
     * Retrieve some rule configuration.
     */
    $_getRule(name: string): GetRuleOptions | undefined

    $_mapLabels(path: string | string[]): string

    /**
     * Returns true if validations runs fine on given value.
     */
    $_match(value: any, state: State, prefs: ValidationOptions): boolean

    $_modify(options?: ModifyOptions): Schema

    /**
     * Resets current schema.
     */
    $_mutateRebuild(): this

    $_mutateRegister(schema: Schema, options?: MutateRegisterOptions): void

    /**
     * Get value from given property.
     */
    $_property(name: string): any

    /**
     * Get schema at given path.
     */
    $_reach(path: string[]): Schema

    /**
     * Get current schema root references.
     */
    $_rootReferences(): any

    /**
     * Set flag to given value.
     */
    $_setFlag(flag: string, value: any, options?: SetFlagOptions): void

    /**
     * Runs internal validations against given value.
     */
    $_validate(value: any, state: State, prefs: ValidationOptions): any
}
