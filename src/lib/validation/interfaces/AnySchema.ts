import {
    BasicType,
    Cache,
    Context,
    CustomHelpers,
    CustomValidator,
    Description,
    ExternalValidationFunction,
    LanguageMessages,
    PresenceMode,
    Reference,
    RuleOptions,
    SchemaLike,
    ValidationErrorFunction,
    ValidationOptions,
    WhenOptions,
    WhenSchemaOptions
} from 'joi'
import {Types} from '../types/Types.js'
import {Schema} from '../types/Schema.js'
import {SchemaFunction} from '../types/SchemaFunction.js'

export interface AnySchema<TSchema = any> {
    type?: Types | undefined;

    allow(...values: any[]): AnySchema<TSchema>

    alter(targets: Record<string, (schema: AnySchema<TSchema>) => Schema<TSchema>>): AnySchema<TSchema>

    artifact(id: any): AnySchema<TSchema>

    bind(): AnySchema<TSchema>

    cache(cache?: Cache | undefined): AnySchema<TSchema>

    cast(to: 'string' | 'number' | 'map' | 'set'): AnySchema<TSchema>

    concat(schema: AnySchema<TSchema>): AnySchema<TSchema>

    custom(fn: CustomValidator<any, any>, description?: string | undefined): AnySchema<TSchema>

    default(value?: Reference | BasicType | ((parent: any, helpers: CustomHelpers<TSchema>) => Reference | BasicType) | undefined): AnySchema<TSchema>

    describe(): Description

    description(desc: string): AnySchema<TSchema>

    disallow(...values: any[]): AnySchema<TSchema>

    empty(schema?: SchemaLike | undefined): AnySchema<TSchema>

    equal(...values: any[]): AnySchema<TSchema>

    error(err: Error | ValidationErrorFunction): AnySchema<TSchema>

    example(value: any, options?: { override: boolean; } | undefined): AnySchema<TSchema>

    exist(): AnySchema<TSchema>

    external(method: ExternalValidationFunction<any, any>, description?: string | undefined): AnySchema<TSchema>

    extract(path: string | string[]): Schema<TSchema>

    failover(value: any): AnySchema<TSchema>

    forbidden(): AnySchema<TSchema>

    fork(key: string | string[] | string[][], adjuster: SchemaFunction): AnySchema<TSchema>

    id(name?: string | undefined): AnySchema<TSchema>

    invalid(...values: any[]): AnySchema<TSchema>

    keep(): AnySchema<TSchema>

    label(name: string): AnySchema<TSchema>

    message(message: string): AnySchema<TSchema>

    messages(messages: LanguageMessages): AnySchema<TSchema>

    meta(meta: object): AnySchema<TSchema>

    not(...values: any[]): AnySchema<TSchema>

    note(...notes: string[]): AnySchema<TSchema>

    only(): AnySchema<TSchema>

    optional(): AnySchema<TSchema>

    options(options: ValidationOptions): AnySchema<TSchema>

    prefs(options: ValidationOptions): AnySchema<TSchema>

    preferences(options: ValidationOptions): AnySchema<TSchema>

    presence(mode: PresenceMode): AnySchema<TSchema>

    raw(enabled?: boolean | undefined): AnySchema<TSchema>

    required(): AnySchema<TSchema>

    rule(options: RuleOptions): AnySchema<TSchema>

    shared(ref: Schema<TSchema>): AnySchema<TSchema>

    strict(isStrict?: boolean | undefined): AnySchema<TSchema>

    strip(enabled?: boolean | undefined): AnySchema<TSchema>

    tag(...tags: string[]): AnySchema<TSchema>

    tailor(targets: string | string[]): Schema<TSchema>

    unit(name: string): AnySchema<TSchema>

    valid(...values: any[]): AnySchema<TSchema>

    warn(): AnySchema<TSchema>

    warning(code: string, context: Context): AnySchema<TSchema>

    when(ref: string | Reference, options: WhenOptions | WhenOptions[]): AnySchema<TSchema>

    when(ref: Schema<TSchema>, options: WhenSchemaOptions): AnySchema<TSchema>

    when(ref: unknown, options: unknown): AnySchema<TSchema>
}

