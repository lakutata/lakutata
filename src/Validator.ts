import 'reflect-metadata'
import 'reflect-metadata'
import Joi from 'joi'
import {As, IsGlobString} from './Utilities.js'
import {InvalidValueException} from './exceptions/InvalidValueException.js'
import {defaultValidationOptions} from './constants/DefaultValue.js'

export class Validator {

    /**
     * 任意类型验证
     * @constructor
     */
    public static Any<TSchema = any>(): AnySchema<TSchema> {
        return Joi.any<TSchema>()
    }

    /**
     * 字符串类型验证
     * @constructor
     */
    public static String<TSchema = string>(): StringSchema<TSchema> {
        return Joi.string<TSchema>()
    }

    /**
     * 数字类型验证
     * @constructor
     */
    public static Number<TSchema = number>(): NumberSchema<TSchema> {
        return Joi.number<TSchema>()
    }

    /**
     * 布尔类型验证
     * @constructor
     */
    public static Boolean<TSchema = boolean>(): BooleanSchema<TSchema> {
        return Joi.boolean<TSchema>()
    }

    /**
     * 日期类型验证
     * @constructor
     */
    public static Date<TSchema = Date>(): DateSchema<TSchema> {
        return Joi.date<TSchema>()
    }

    /**
     * 对象类型验证
     * @param schema
     * @constructor
     */
    public static Object<TSchema = any, isStrict = false, T = TSchema>(schema?: SchemaMap<T, isStrict>): ObjectSchema<TSchema> {
        return Joi.object<TSchema, isStrict, T>(schema as any)
    }

    /**
     * 数组类型验证
     * @param types
     * @constructor
     */
    public static Array<TSchema = any[]>(...types: SchemaLikeWithoutArray[]): ArraySchema<TSchema> {
        return Joi.array<TSchema>().items(...types)
    }

    /**
     * 二进制类型验证
     * @constructor
     */
    public static Binary<TSchema = Buffer>(): BinarySchema<TSchema> {
        return Joi.binary<TSchema>()
    }

    /**
     * 方法类型验证
     * @constructor
     */
    public static Function<TSchema = Function>(): FunctionSchema<TSchema> {
        return Joi.func<TSchema>()
    }

    /**
     * 类验证器
     * @param inheritsFrom
     * @constructor
     */
    public static Class<TSchema = Function>(inheritsFrom?: TSchema): FunctionSchema<TSchema> {
        if (!inheritsFrom) return Joi.func<TSchema>().class()
        return Joi.func<TSchema>().class().custom((value: TSchema, helpers: CustomHelpers) => {
            if (value instanceof As(inheritsFrom) || value['prototype'] instanceof As(inheritsFrom)) return value
            return helpers.error('any.invalid')
        }, 'Class Validation')
    }

    /**
     * 通配符匹配操作符字符串验证器
     * @constructor
     */
    public static Glob<TSchema = string>(): StringSchema<TSchema> {
        return Joi.string<TSchema>().custom((value: TSchema, helpers: CustomHelpers) => {
            if (typeof value === 'string' && IsGlobString(value)) return value
            return helpers.error('any.invalid')

        }, 'Glob Validation')
    }

    /**
     * 符号类型验证
     * @constructor
     */
    public static Symbol<TSchema = Symbol>(): SymbolSchema<TSchema> {
        return Joi.symbol<TSchema>()
    }

    /**
     * 可选参数类型验证
     * @param types
     * @constructor
     */
    public static Alternatives<TSchema = any>(...types: SchemaLike[]): AlternativesSchema<TSchema> {
        return Joi.alternatives<TSchema>(...types)
    }

    /**
     * 为已命名的键值生成引用
     * @param key
     * @param options
     * @constructor
     */
    public static Ref(key: string, options?: ReferenceOptions): Reference {
        return Joi.ref(key, options)
    }

    /**
     * 将一个键标记为禁止，该键将不允许除undefined以外的任何值。用于明确禁止键。
     * @constructor
     */
    public static Forbidden(): Schema {
        return Joi.forbidden()
    }

    /**
     * 创建一个引用，当解析时，将其作为值数组用于与规则进行匹配。
     * @param ref
     * @param options
     * @constructor
     */
    public static In(ref: string, options?: ReferenceOptions): Reference {
        return Joi.in(ref, options)
    }

    /**
     * 对值进行模式验证，返回有效的对象，如果验证失败则抛出异常。
     * @param value
     * @param schema
     * @param options
     * @constructor
     */
    public static Attempt<TSchema extends Schema>(value: any, schema: TSchema, options?: ValidationOptions): TSchema extends Schema<infer Value> ? Value : never {
        return Joi.attempt(value, schema, options) as any
    }

    /**
     * 根据Schema验证数据（同步方法）
     * @param data
     * @param schema
     * @param options
     */
    public static validate<T = any>(data: T, schema: Schema, options?: ValidationOptions): T {
        options = options ? Object.assign({}, defaultValidationOptions, options) : defaultValidationOptions
        const {error, value} = schema.validate(data, options)
        if (error) throw new InvalidValueException(error.message)
        return value
    }

    /**
     * 根据Schema验证数据（异步方法）
     * @param data
     * @param schema
     * @param options
     */
    public static async validateAsync<T = any>(data: T, schema: Schema, options?: ValidationOptions): Promise<T> {
        options = options ? Object.assign({}, defaultValidationOptions, options) : defaultValidationOptions
        try {
            return schema.validateAsync(data, options)
        } catch (e) {
            throw new InvalidValueException((e as Error).message)
        }
    }
}

export type Types =
    | 'any'
    | 'alternatives'
    | 'array'
    | 'boolean'
    | 'binary'
    | 'date'
    | 'function'
    | 'link'
    | 'number'
    | 'object'
    | 'string'
    | 'symbol';

export type BasicType = boolean | number | string | any[] | object | null;

export type LanguageMessages = Record<string, string>;

export type PresenceMode = 'optional' | 'required' | 'forbidden';

export interface ErrorFormattingOptions {
    /**
     * when true, error message templates will escape special characters to HTML entities, for security purposes.
     *
     * @default false
     */
    escapeHtml?: boolean;
    /**
     * defines the value used to set the label context variable.
     */
    label?: 'path' | 'key' | false;
    /**
     * The preferred language code for error messages.
     * The value is matched against keys at the root of the messages object, and then the error code as a child key of that.
     * Can be a reference to the value, global context, or local context which is the root value passed to the validation function.
     *
     * Note that references to the value are usually not what you want as they move around the value structure relative to where the error happens.
     * Instead, either use the global context, or the absolute value (e.g. `Joi.ref('/variable')`)
     */
    language?: keyof LanguageMessages;
    /**
     * when false, skips rendering error templates. Useful when error messages are generated elsewhere to save processing time.
     *
     * @default true
     */
    render?: boolean;
    /**
     * when true, the main error will possess a stack trace, otherwise it will be disabled.
     * Defaults to false for performances reasons. Has no effect on platforms other than V8/node.js as it uses the Stack trace API.
     *
     * @default false
     */
    stack?: boolean;
    /**
     * overrides the way values are wrapped (e.g. `[]` around arrays, `""` around labels).
     * Each key can be set to a string with one (same character before and after the value) or two characters (first character
     * before and second character after), or `false` to disable wrapping.
     */
    wrap?: {
        /**
         * the characters used around `{#label}` references. Defaults to `'"'`.
         *
         * @default '"'
         */
        label?: string | false,

        /**
         * the characters used around array values. Defaults to `'[]'`
         *
         * @default '[]'
         */
        array?: string | false

        /**
         * the characters used around array string values. Defaults to no wrapping.
         *
         * @default false
         */
        string?: string | false
    };
}

export interface BaseValidationOptions {
    /**
     * when true, stops validation on the first error, otherwise returns all the errors found.
     *
     * @default true
     */
    abortEarly?: boolean;
    /**
     * when true, allows object to contain unknown keys which are ignored.
     *
     * @default false
     */
    allowUnknown?: boolean;
    /**
     * when true, return artifacts alongside the value.
     *
     * @default false
     */
    artifacts?: boolean;
    /**
     * when true, schema caching is enabled (for schemas with explicit caching rules).
     *
     * @default false
     */
    cache?: boolean;
    /**
     * provides an external data set to be used in references
     */
    context?: Context;
    /**
     * when true, attempts to cast values to the required types (e.g. a string to a number).
     *
     * @default true
     */
    convert?: boolean;
    /**
     * sets the string format used when converting dates to strings in error messages and casting.
     *
     * @default 'iso'
     */
    dateFormat?: 'date' | 'iso' | 'string' | 'time' | 'utc';
    /**
     * when true, valid results and throw errors are decorated with a debug property which includes an array of the validation steps used to generate the returned result.
     *
     * @default false
     */
    debug?: boolean;
    /**
     * error formatting settings.
     */
    errors?: ErrorFormattingOptions;
    /**
     * if false, the external rules set with `any.external()` are ignored, which is required to ignore any external validations in synchronous mode (or an exception is thrown).
     *
     * @default true
     */
    externals?: boolean;
    /**
     * when true, do not apply default values.
     *
     * @default false
     */
    noDefaults?: boolean;
    /**
     * when true, inputs are shallow cloned to include non-enumerable properties.
     *
     * @default false
     */
    nonEnumerables?: boolean;
    /**
     * sets the default presence requirements. Supported modes: 'optional', 'required', and 'forbidden'.
     *
     * @default 'optional'
     */
    presence?: PresenceMode;
    /**
     * when true, ignores unknown keys with a function value.
     *
     * @default false
     */
    skipFunctions?: boolean;
    /**
     * remove unknown elements from objects and arrays.
     * - when true, all unknown elements will be removed
     * - when an object:
     *      - objects - set to true to remove unknown keys from objects
     *
     * @default false
     */
    stripUnknown?: boolean | { arrays?: boolean; objects?: boolean };
}

export interface ValidationOptions extends BaseValidationOptions {
    /**
     * overrides individual error messages. Defaults to no override (`{}`).
     * Messages use the same rules as templates.
     * Variables in double braces `{{var}}` are HTML escaped if the option `errors.escapeHtml` is set to true.
     *
     * @default {}
     */
    messages?: LanguageMessages;
}

export interface AsyncValidationOptions extends ValidationOptions {
    /**
     * when true, artifacts are returned alongside the value (i.e. `{ value, artifacts }`)
     *
     * @default false
     */
    artifacts?: boolean;
    /**
     * when true, warnings are returned alongside the value (i.e. `{ value, warning }`).
     *
     * @default false
     */
    warnings?: boolean;
}

export interface LanguageMessageTemplate {
    source: string;
    rendered: string;
}

export interface ErrorValidationOptions extends BaseValidationOptions {
    messages?: Record<string, LanguageMessageTemplate>;
}

export interface RenameOptions {
    /**
     * if true, does not delete the old key name, keeping both the new and old keys in place.
     *
     * @default false
     */
    alias?: boolean;
    /**
     * if true, allows renaming multiple keys to the same destination where the last rename wins.
     *
     * @default false
     */
    multiple?: boolean;
    /**
     * if true, allows renaming a key over an existing key.
     *
     * @default false
     */
    override?: boolean;
    /**
     * if true, skip renaming of a key if it's undefined.
     *
     * @default false
     */
    ignoreUndefined?: boolean;
}

export interface TopLevelDomainOptions {
    /**
     * - `true` to use the IANA list of registered TLDs. This is the default value.
     * - `false` to allow any TLD not listed in the `deny` list, if present.
     * - A `Set` or array of the allowed TLDs. Cannot be used together with `deny`.
     */
    allow?: Set<string> | string[] | boolean;
    /**
     * - A `Set` or array of the forbidden TLDs. Cannot be used together with a custom `allow` list.
     */
    deny?: Set<string> | string[];
}

export interface HierarchySeparatorOptions {
    /**
     * overrides the default `.` hierarchy separator. Set to false to treat the key as a literal value.
     *
     * @default '.'
     */
    separator?: string | false;
}

export interface DependencyOptions extends HierarchySeparatorOptions {
    /**
     * overrides the default check for a present value.
     *
     * @default (resolved) => resolved !== undefined
     */
    isPresent?: (resolved: any) => boolean;
}

export interface EmailOptions {
    /**
     * if `true`, domains ending with a `.` character are permitted
     *
     * @default false
     */
    allowFullyQualified?: boolean;
    /**
     * If `true`, Unicode characters are permitted
     *
     * @default true
     */
    allowUnicode?: boolean;
    /**
     * if `true`, ignore invalid email length errors.
     *
     * @default false
     */
    ignoreLength?: boolean;
    /**
     * if true, allows multiple email addresses in a single string, separated by , or the separator characters.
     *
     * @default false
     */
    multiple?: boolean;
    /**
     * when multiple is true, overrides the default , separator. String can be a single character or multiple separator characters.
     *
     * @default ','
     */
    separator?: string | string[];
    /**
     * Options for TLD (top level domain) validation. By default, the TLD must be a valid name listed on the [IANA registry](http://data.iana.org/TLD/tlds-alpha-by-domain.txt)
     *
     * @default { allow: true }
     */
    tlds?: TopLevelDomainOptions | false;
    /**
     * Number of segments required for the domain. Be careful since some domains, such as `io`, directly allow email.
     *
     * @default 2
     */
    minDomainSegments?: number;
    /**
     * The maximum number of domain segments (e.g. `x.y.z` has 3 segments) allowed. Defaults to no limit.
     *
     * @default Infinity
     */
    maxDomainSegments?: number;
}

export interface DomainOptions {
    /**
     * if `true`, domains ending with a `.` character are permitted
     *
     * @default false
     */
    allowFullyQualified?: boolean;
    /**
     * If `true`, Unicode characters are permitted
     *
     * @default true
     */
    allowUnicode?: boolean;

    /**
     * Options for TLD (top level domain) validation. By default, the TLD must be a valid name listed on the [IANA registry](http://data.iana.org/TLD/tlds-alpha-by-domain.txt)
     *
     * @default { allow: true }
     */
    tlds?: TopLevelDomainOptions | false;
    /**
     * Number of segments required for the domain.
     *
     * @default 2
     */
    minDomainSegments?: number;
    /**
     * The maximum number of domain segments (e.g. `x.y.z` has 3 segments) allowed. Defaults to no limit.
     *
     * @default Infinity
     */
    maxDomainSegments?: number;
}

export interface HexOptions {
    /**
     * hex decoded representation must be byte aligned.
     * @default false
     */
    byteAligned?: boolean;
}

export interface IpOptions {
    /**
     * One or more IP address versions to validate against. Valid values: ipv4, ipv6, ipvfuture
     */
    version?: string | string[];
    /**
     * Used to determine if a CIDR is allowed or not. Valid values: optional, required, forbidden
     */
    cidr?: PresenceMode;
}

export type GuidVersions = 'uuidv1' | 'uuidv2' | 'uuidv3' | 'uuidv4' | 'uuidv5';

export interface GuidOptions {
    version?: GuidVersions[] | GuidVersions;
    separator?: boolean | '-' | ':';
}

export interface UriOptions {
    /**
     * Specifies one or more acceptable Schemes, should only include the scheme name.
     * Can be an Array or String (strings are automatically escaped for use in a Regular Expression).
     */
    scheme?: string | RegExp | Array<string | RegExp>;
    /**
     * Allow relative URIs.
     *
     * @default false
     */
    allowRelative?: boolean;
    /**
     * Restrict only relative URIs.
     *
     * @default false
     */
    relativeOnly?: boolean;
    /**
     * Allows unencoded square brackets inside the query string.
     * This is NOT RFC 3986 compliant but query strings like abc[]=123&abc[]=456 are very common these days.
     *
     * @default false
     */
    allowQuerySquareBrackets?: boolean;
    /**
     * Validate the domain component using the options specified in `string.domain()`.
     */
    domain?: DomainOptions;
}

export interface DataUriOptions {
    /**
     * optional parameter defaulting to true which will require `=` padding if true or make padding optional if false
     *
     * @default true
     */
    paddingRequired?: boolean;
}

export interface Base64Options extends Pick<DataUriOptions, 'paddingRequired'> {
    /**
     * if true, uses the URI-safe base64 format which replaces `+` with `-` and `\` with `_`.
     *
     * @default false
     */
    urlSafe?: boolean;
}

export interface SwitchCases {
    /**
     * the required condition joi type.
     */
    is: SchemaLike;
    /**
     * the alternative schema type if the condition is true.
     */
    then: SchemaLike;
}

export interface SwitchDefault {
    /**
     * the alternative schema type if no cases matched.
     * Only one otherwise statement is allowed in switch as the last array item.
     */
    otherwise: SchemaLike;
}

export interface WhenOptions {
    /**
     * the required condition joi type.
     */
    is?: SchemaLike;

    /**
     * the negative version of `is` (`then` and `otherwise` have reverse
     * roles).
     */
    not?: SchemaLike;

    /**
     * the alternative schema type if the condition is true. Required if otherwise or switch are missing.
     */
    then?: SchemaLike;

    /**
     * the alternative schema type if the condition is false. Required if then or switch are missing.
     */
    otherwise?: SchemaLike;

    /**
     * the list of cases. Required if then is missing.  Required if then or otherwise are missing.
     */
    switch?: Array<SwitchCases | SwitchDefault>;

    /**
     * whether to stop applying further conditions if the condition is true.
     */
    break?: boolean;
}

export interface WhenSchemaOptions {
    /**
     * the alternative schema type if the condition is true. Required if otherwise is missing.
     */
    then?: SchemaLike;
    /**
     * the alternative schema type if the condition is false. Required if then is missing.
     */
    otherwise?: SchemaLike;
}

export interface Cache {
    /**
     * Add an item to the cache.
     *
     * Note that key and value can be anything including objects, array, etc.
     */
    set(key: any, value: any): void;

    /**
     * Retrieve an item from the cache.
     *
     * Note that key and value can be anything including objects, array, etc.
     */
    get(key: any): any;
}

export interface CacheProvisionOptions {
    /**
     * number of items to store in the cache before the least used items are dropped.
     *
     * @default 1000
     */
    max: number;
}

export interface CacheConfiguration {
    /**
     * Provisions a simple LRU cache for caching simple inputs (`undefined`, `null`, strings, numbers, and booleans).
     */
    provision(options?: CacheProvisionOptions): void;
}

export interface CompileOptions {
    /**
     * If true and the provided schema is (or contains parts) using an older version of joi, will return a compiled schema that is compatible with the older version.
     * If false, the schema is always compiled using the current version and if older schema components are found, an error is thrown.
     */
    legacy: boolean;
}

export interface IsSchemaOptions {
    /**
     * If true, will identify schemas from older versions of joi, otherwise will throw an error.
     *
     * @default false
     */
    legacy: boolean;
}

export interface ReferenceOptions extends HierarchySeparatorOptions {
    /**
     * a function with the signature `function(value)` where `value` is the resolved reference value and the return value is the adjusted value to use.
     * Note that the adjust feature will not perform any type validation on the adjusted value and it must match the value expected by the rule it is used in.
     * Cannot be used with `map`.
     *
     * @example `(value) => value + 5`
     */
    adjust?: (value: any) => any;

    /**
     * an array of array pairs using the format `[[key, value], [key, value]]` used to maps the resolved reference value to another value.
     * If the resolved value is not in the map, it is returned as-is.
     * Cannot be used with `adjust`.
     */
    map?: Array<[any, any]>;

    /**
     * overrides default prefix characters.
     */
    prefix?: {
        /**
         * references to the globally provided context preference.
         *
         * @default '$'
         */
        global?: string;

        /**
         * references to error-specific or rule specific context.
         *
         * @default '#'
         */
        local?: string;

        /**
         * references to the root value being validated.
         *
         * @default '/'
         */
        root?: string;
    };

    /**
     * If set to a number, sets the reference relative starting point.
     * Cannot be combined with separator prefix characters.
     * Defaults to the reference key prefix (or 1 if none present)
     */
    ancestor?: number;

    /**
     * creates an in-reference.
     */
    in?: boolean;

    /**
     * when true, the reference resolves by reaching into maps and sets.
     */
    iterables?: boolean;

    /**
     * when true, the value of the reference is used instead of its name in error messages
     * and template rendering. Defaults to false.
     */
    render?: boolean;
}

export interface StringRegexOptions {
    /**
     * optional pattern name.
     */
    name?: string;

    /**
     * when true, the provided pattern will be disallowed instead of required.
     *
     * @default false
     */
    invert?: boolean;
}

export interface RuleOptions {
    /**
     * if true, the rules will not be replaced by the same unique rule later.
     *
     * For example, `Joi.number().min(1).rule({ keep: true }).min(2)` will keep both `min()` rules instead of the later rule overriding the first.
     *
     * @default false
     */
    keep?: boolean;

    /**
     * a single message string or a messages object where each key is an error code and corresponding message string as value.
     *
     * The object is the same as the messages used as an option in `any.validate()`.
     * The strings can be plain messages or a message template.
     */
    message?: string | LanguageMessages;

    /**
     * if true, turns any error generated by the ruleset to warnings.
     */
    warn?: boolean;
}

export interface ErrorReport extends Error {
    code: string;
    flags: Record<string, ExtensionFlag>;
    path: string[];
    prefs: ErrorValidationOptions;
    messages: LanguageMessages;
    state: State;
    value: any;
    local: any;
}

export interface ValidationError extends Error {
    name: 'ValidationError';

    isJoi: boolean;

    /**
     * array of errors.
     */
    details: ValidationErrorItem[];

    /**
     * function that returns a string with an annotated version of the object pointing at the places where errors occurred.
     *
     * NOTE: This method does not exist in browser builds of Joi
     *
     * @param stripColors - if truthy, will strip the colors out of the output.
     */
    annotate(stripColors?: boolean): string;

    _original: any;
}

export interface ValidationErrorItem {
    message: string;
    path: Array<string | number>;
    type: string;
    context?: Context;
}

export type ValidationErrorFunction = (errors: ErrorReport[]) => string | ValidationErrorItem | Error;

export interface ValidationWarning {
    message: string;

    details: ValidationErrorItem[];
}

export type ValidationResult<TSchema = any> = {
    error: undefined;
    warning?: ValidationError;
    value: TSchema;
} | {
    error: ValidationError;
    warning?: ValidationError;
    value: undefined;
}

export interface CreateErrorOptions {
    flags?: boolean;
    messages?: LanguageMessages;
}

export interface ModifyOptions {
    each?: boolean;
    once?: boolean;
    ref?: boolean;
    schema?: boolean;
}

export interface MutateRegisterOptions {
    family?: any;
    key?: any;
}

export interface SetFlagOptions {
    clone: boolean;
}

export interface CustomHelpers<V = any> {
    schema: ExtensionBoundSchema;
    state: State;
    prefs: ValidationOptions;
    original: V;
    warn: (code: string, local?: Context) => void;
    error: (code: string, local?: Context) => ErrorReport;
    message: (messages: LanguageMessages, local?: Context) => ErrorReport;
}

export type CustomValidator<V = any, R = V> = (value: V, helpers: CustomHelpers<R>) => R | ErrorReport;

export interface ExternalHelpers<V = any> {
    schema: ExtensionBoundSchema;
    linked: ExtensionBoundSchema | null;
    state: State;
    prefs: ValidationOptions;
    original: V;
    warn: (code: string, local?: Context) => void;
    error: (code: string, local?: Context) => ErrorReport;
    message: (messages: LanguageMessages, local?: Context) => ErrorReport;
}

export type ExternalValidationFunction<V = any, R = V> = (value: V, helpers: ExternalHelpers<R>) => R | undefined;

export type SchemaLikeWithoutArray = string | number | boolean | null | Schema | SchemaMap;
export type SchemaLike = SchemaLikeWithoutArray | object;

export type NullableType<T> = undefined | null | T

export type IsPrimitiveSubset<T> =
    [T] extends [string]
        ? true
        : [T] extends [number]
            ? true
            : [T] extends [bigint]
                ? true
                : [T] extends [boolean]
                    ? true
                    : [T] extends [symbol]
                        ? true
                        : [T] extends [null]
                            ? true
                            : [T] extends [undefined]
                                ? true
                                : false;

export type IsUnion<T, U extends T = T> =
    T extends unknown ? [U] extends [T] ? false : true : false;

export type IsNonPrimitiveSubsetUnion<T> = true extends IsUnion<T> ? true extends IsPrimitiveSubset<T> ? false : true : false;

export type ObjectPropertiesSchema<T = any> =
    true extends IsNonPrimitiveSubsetUnion<Exclude<T, undefined | null>>
        ? AlternativesSchema
        : T extends NullableType<string>
            ? StringSchema
            : T extends NullableType<number>
                ? NumberSchema
                : T extends NullableType<bigint>
                    ? NumberSchema
                    : T extends NullableType<boolean>
                        ? BooleanSchema
                        : T extends NullableType<Date>
                            ? DateSchema
                            : T extends NullableType<Array<any>>
                                ? ArraySchema
                                : T extends NullableType<object>
                                    ? (StrictSchemaMap<T> | ObjectSchema<T>)
                                    : never

export type PartialSchemaMap<TSchema = any> = {
    [key in keyof TSchema]?: SchemaLike | SchemaLike[];
}

export type StrictSchemaMap<TSchema = any> = {
    [key in keyof TSchema]-?: ObjectPropertiesSchema<TSchema[key]>
};

export type SchemaMap<TSchema = any, isStrict = false> = isStrict extends true ? StrictSchemaMap<TSchema> : PartialSchemaMap<TSchema>

export type Schema<P = any> =
    | AnySchema<P>
    | ArraySchema<P>
    | AlternativesSchema<P>
    | BinarySchema<P>
    | BooleanSchema<P>
    | DateSchema<P>
    | FunctionSchema<P>
    | NumberSchema<P>
    | ObjectSchema<P>
    | StringSchema<P>
    | LinkSchema<P>
    | SymbolSchema<P>;

export type SchemaFunction = (schema: Schema) => Schema;

export interface AddRuleOptions {
    name: string;
    args?: {
        [key: string]: any;
    };
}

export interface GetRuleOptions {
    args?: Record<string, any>;
    method?: string;
    name: string;
    operator?: string;
}

export interface SchemaInternals {
    /**
     * Parent schema object.
     */
    $_super: Schema;

    /**
     * Terms of current schema.
     */
    $_terms: Record<string, any>;

    /**
     * Adds a rule to current validation schema.
     */
    $_addRule(rule: string | AddRuleOptions): Schema;

    /**
     * Internally compiles schema.
     */
    $_compile(schema: SchemaLike, options?: CompileOptions): Schema;

    /**
     * Creates a joi error object.
     */
    $_createError(
        code: string,
        value: any,
        context: Context,
        state: State,
        prefs: ValidationOptions,
        options?: CreateErrorOptions
    ): Err;

    /**
     * Get value from given flag.
     */
    $_getFlag(name: string): any;

    /**
     * Retrieve some rule configuration.
     */
    $_getRule(name: string): GetRuleOptions | undefined;

    $_mapLabels(path: string | string[]): string;

    /**
     * Returns true if validations runs fine on given value.
     */
    $_match(value: any, state: State, prefs: ValidationOptions): boolean;

    $_modify(options?: ModifyOptions): Schema;

    /**
     * Resets current schema.
     */
    $_mutateRebuild(): this;

    $_mutateRegister(schema: Schema, options?: MutateRegisterOptions): void;

    /**
     * Get value from given property.
     */
    $_property(name: string): any;

    /**
     * Get schema at given path.
     */
    $_reach(path: string[]): Schema;

    /**
     * Get current schema root references.
     */
    $_rootReferences(): any;

    /**
     * Set flag to given value.
     */
    $_setFlag(flag: string, value: any, options?: SetFlagOptions): void;

    /**
     * Runs internal validations against given value.
     */
    $_validate(value: any, state: State, prefs: ValidationOptions): ValidationResult;
}

export interface AnySchema<TSchema = any> extends SchemaInternals {
    /**
     * Flags of current schema.
     */
    _flags: Record<string, any>;

    /**
     * Starts a ruleset in order to apply multiple rule options. The set ends when `rule()`, `keep()`, `message()`, or `warn()` is called.
     */
    $: this;

    /**
     * Starts a ruleset in order to apply multiple rule options. The set ends when `rule()`, `keep()`, `message()`, or `warn()` is called.
     */
    ruleset: this;

    type?: Types | string;

    /**
     * Whitelists a value
     */
    allow(...values: any[]): this;

    /**
     * Assign target alteration options to a schema that are applied when `any.tailor()` is called.
     * @param targets - an object where each key is a target name, and each value is a function that takes an schema and returns an schema.
     */
    alter(targets: Record<string, (schema: this) => Schema>): this;

    /**
     * Assigns the schema an artifact id which is included in the validation result if the rule passed validation.
     * @param id - any value other than undefined which will be returned as-is in the result artifacts map.
     */
    artifact(id: any): this;

    /**
     * By default, some Joi methods to function properly need to rely on the Joi instance they are attached to because
     * they use `this` internally.
     * So `Joi.string()` works but if you extract the function from it and call `string()` it won't.
     * `bind()` creates a new Joi instance where all the functions relying on `this` are bound to the Joi instance.
     */
    bind(): this;

    /**
     * Adds caching to the schema which will attempt to cache the validation results (success and failures) of incoming inputs.
     * If no cache is passed, a default cache is provisioned by using `cache.provision()` internally.
     */
    cache(cache?: Cache): this;

    /**
     * Casts the validated value to the specified type.
     */
    cast(to: 'map' | 'number' | 'set' | 'string'): this;

    /**
     * Returns a new type that is the result of adding the rules of one type to another.
     */
    concat(schema: this): this;

    /**
     * Adds a custom validation function.
     */
    custom(fn: CustomValidator, description?: string): this;

    /**
     * Sets a default value if the original value is `undefined` where:
     * @param value - the default value. One of:
     *    - a literal value (string, number, object, etc.)
     *    - a [references](#refkey-options)
     *    - a function which returns the default value using the signature `function(parent, helpers)` where:
     *        - `parent` - a clone of the object containing the value being validated. Note that since specifying a
     *          `parent` argument performs cloning, do not declare format arguments if you are not using them.
     *        - `helpers` - same as those described in [`any.custom()`](anycustomermethod_description)
     *
     * When called without any `value` on an object schema type, a default value will be automatically generated
     * based on the default values of the object keys.
     *
     * Note that if value is an object, any changes to the object after `default()` is called will change the
     *  reference and any future assignment.
     */
    default(value?: BasicType | Reference | ((parent: any, helpers: CustomHelpers) => BasicType | Reference)): this;

    /**
     * Returns a plain object representing the schema's rules and properties
     */
    describe(): Description;

    /**
     * Annotates the key
     */
    description(desc: string): this;

    /**
     * Disallows values.
     */
    disallow(...values: any[]): this;

    /**
     * Considers anything that matches the schema to be empty (undefined).
     * @param schema - any object or joi schema to match. An undefined schema unsets that rule.
     */
    empty(schema?: SchemaLike): this;

    /**
     * Adds the provided values into the allowed whitelist and marks them as the only valid values allowed.
     */
    equal(...values: any[]): this;

    /**
     * Overrides the default joi error with a custom error if the rule fails where:
     * @param err - can be:
     *   an instance of `Error` - the override error.
     *   a `function(errors)`, taking an array of errors as argument, where it must either:
     *    return a `string` - substitutes the error message with this text
     *    return a single ` object` or an `Array` of it, where:
     *     `type` - optional parameter providing the type of the error (eg. `number.min`).
     *     `message` - optional parameter if `template` is provided, containing the text of the error.
     *     `template` - optional parameter if `message` is provided, containing a template string, using the same format as usual joi language errors.
     *     `context` - optional parameter, to provide context to your error if you are using the `template`.
     *    return an `Error` - same as when you directly provide an `Error`, but you can customize the error message based on the errors.
     *
     * Note that if you provide an `Error`, it will be returned as-is, unmodified and undecorated with any of the
     * normal joi error properties. If validation fails and another error is found before the error
     * override, that error will be returned and the override will be ignored (unless the `abortEarly`
     * option has been set to `false`).
     */
    error(err: Error | ValidationErrorFunction): this;

    /**
     * Annotates the key with an example value, must be valid.
     */
    example(value: any, options?: { override: boolean }): this;

    /**
     * Marks a key as required which will not allow undefined as value. All keys are optional by default.
     */
    exist(): this;

    /**
     * Adds an external validation rule.
     *
     * Note that external validation rules are only called after the all other validation rules for the entire schema (from the value root) are checked.
     * This means that any changes made to the value by the external rules are not available to any other validation rules during the non-external validation phase.
     * If schema validation failed, no external validation rules are called.
     */
    external(method: ExternalValidationFunction, description?: string): this;

    /**
     * Returns a sub-schema based on a path of object keys or schema ids.
     *
     * @param path - a dot `.` separated path string or a pre-split array of path keys. The keys must match the sub-schema id or object key (if no id was explicitly set).
     */
    extract(path: string | string[]): Schema;

    /**
     * Sets a failover value if the original value fails passing validation.
     *
     * @param value - the failover value. value supports references. value may be assigned a function which returns the default value.
     *
     * If value is specified as a function that accepts a single parameter, that parameter will be a context object that can be used to derive the resulting value.
     * Note that if value is an object, any changes to the object after `failover()` is called will change the reference and any future assignment.
     * Use a function when setting a dynamic value (e.g. the current time).
     * Using a function with a single argument performs some internal cloning which has a performance impact.
     * If you do not need access to the context, define the function without any arguments.
     */
    failover(value: any): this;

    /**
     * Marks a key as forbidden which will not allow any value except undefined. Used to explicitly forbid keys.
     */
    forbidden(): this;

    /**
     * Returns a new schema where each of the path keys listed have been modified.
     *
     * @param key - an array of key strings, a single key string, or an array of arrays of pre-split key strings.
     * @param adjuster - a function which must return a modified schema.
     */
    fork(key: string | string[] | string[][], adjuster: SchemaFunction): this;

    /**
     * Sets a schema id for reaching into the schema via `any.extract()`.
     * If no id is set, the schema id defaults to the object key it is associated with.
     * If the schema is used in an array or alternatives type and no id is set, the schema in unreachable.
     */
    id(name?: string): this;

    /**
     * Disallows values.
     */
    invalid(...values: any[]): this;

    /**
     * Same as `rule({ keep: true })`.
     *
     * Note that `keep()` will terminate the current ruleset and cannot be followed by another rule option.
     * Use `rule()` to apply multiple rule options.
     */
    keep(): this;

    /**
     * Overrides the key name in error messages.
     */
    label(name: string): this;

    /**
     * Same as `rule({ message })`.
     *
     * Note that `message()` will terminate the current ruleset and cannot be followed by another rule option.
     * Use `rule()` to apply multiple rule options.
     */
    message(message: string): this;

    /**
     * Same as `any.prefs({ messages })`.
     * Note that while `any.message()` applies only to the last rule or ruleset, `any.messages()` applies to the entire schema.
     */
    messages(messages: LanguageMessages): this;

    /**
     * Attaches metadata to the key.
     */
    meta(meta: object): this;

    /**
     * Disallows values.
     */
    not(...values: any[]): this;

    /**
     * Annotates the key
     */
    note(...notes: string[]): this;

    /**
     * Requires the validated value to match of the provided `any.allow()` values.
     * It has not effect when called together with `any.valid()` since it already sets the requirements.
     * When used with `any.allow()` it converts it to an `any.valid()`.
     */
    only(): this;

    /**
     * Marks a key as optional which will allow undefined as values. Used to annotate the schema for readability as all keys are optional by default.
     */
    optional(): this;

    /**
     * Overrides the global validate() options for the current key and any sub-key.
     */
    options(options: ValidationOptions): this;

    /**
     * Overrides the global validate() options for the current key and any sub-key.
     */
    prefs(options: ValidationOptions): this;

    /**
     * Overrides the global validate() options for the current key and any sub-key.
     */
    preferences(options: ValidationOptions): this;

    /**
     * Sets the presence mode for the schema.
     */
    presence(mode: PresenceMode): this;

    /**
     * Outputs the original untouched value instead of the casted value.
     */
    raw(enabled?: boolean): this;

    /**
     * Marks a key as required which will not allow undefined as value. All keys are optional by default.
     */
    required(): this;

    /**
     * Applies a set of rule options to the current ruleset or last rule added.
     *
     * When applying rule options, the last rule (e.g. `min()`) is used unless there is an active ruleset defined (e.g. `$.min().max()`)
     * in which case the options are applied to all the provided rules.
     * Once `rule()` is called, the previous rules can no longer be modified and any active ruleset is terminated.
     *
     * Rule modifications can only be applied to supported rules.
     * Most of the `any` methods do not support rule modifications because they are implemented using schema flags (e.g. `required()`) or special
     * internal implementation (e.g. `valid()`).
     * In those cases, use the `any.messages()` method to override the error codes for the errors you want to customize.
     */
    rule(options: RuleOptions): this;

    /**
     * Registers a schema to be used by descendants of the current schema in named link references.
     */
    shared(ref: Schema): this;

    /**
     * Sets the options.convert options to false which prevent type casting for the current key and any child keys.
     */
    strict(isStrict?: boolean): this;

    /**
     * Marks a key to be removed from a resulting object or array after validation. Used to sanitize output.
     * @param [enabled=true] - if true, the value is stripped, otherwise the validated value is retained. Defaults to true.
     */
    strip(enabled?: boolean): this;

    /**
     * Annotates the key
     */
    tag(...tags: string[]): this;

    /**
     * Applies any assigned target alterations to a copy of the schema that were applied via `any.alter()`.
     */
    tailor(targets: string | string[]): Schema;

    /**
     * Annotates the key with an unit name.
     */
    unit(name: string): this;

    /**
     * Adds the provided values into the allowed whitelist and marks them as the only valid values allowed.
     */
    valid(...values: any[]): this;

    /**
     * Validates a value using the schema and options.
     */
    validate(value: any, options?: ValidationOptions): ValidationResult<TSchema>;

    /**
     * Validates a value using the schema and options.
     */
    validateAsync<TOpts extends AsyncValidationOptions>(
        value: any,
        options?: TOpts
    ): Promise<
        TOpts extends { artifacts: true } | { warnings: true }
            ? { value: TSchema } & (TOpts extends { artifacts: true }
            ? { artifacts: Map<any, string[][]> }
            : {}) &
            (TOpts extends { warnings: true }
                ? { warning: ValidationWarning }
                : {})
            : TSchema
    >;

    /**
     * Same as `rule({ warn: true })`.
     * Note that `warn()` will terminate the current ruleset and cannot be followed by another rule option.
     * Use `rule()` to apply multiple rule options.
     */
    warn(): this;

    /**
     * Generates a warning.
     * When calling `any.validateAsync()`, set the `warning` option to true to enable warnings.
     * Warnings are reported separately from errors alongside the result value via the warning key (i.e. `{ value, warning }`).
     * Warning are always included when calling `any.validate()`.
     */
    warning(code: string, context: Context): this;

    /**
     * Converts the type into an alternatives type where the conditions are merged into the type definition where:
     */
    when(ref: string | Reference, options: WhenOptions | WhenOptions[]): this;

    /**
     * Converts the type into an alternatives type where the conditions are merged into the type definition where:
     */
    when(ref: Schema, options: WhenSchemaOptions): this;
}

export interface Description {
    type?: Types | string;
    label?: string;
    description?: string;
    flags?: object;
    notes?: string[];
    tags?: string[];
    meta?: any[];
    example?: any[];
    valids?: any[];
    invalids?: any[];
    unit?: string;
    options?: ValidationOptions;

    [key: string]: any;
}

export interface Context {
    [key: string]: any;

    key?: string;
    label?: string;
    value?: any;
}

export interface State {
    key?: string;
    path?: string;
    parent?: any;
    reference?: any;
    ancestors?: any;

    localize?(...args: any[]): State;
}

export interface BooleanSchema<TSchema = boolean> extends AnySchema<TSchema> {
    /**
     * Allows for additional values to be considered valid booleans by converting them to false during validation.
     * String comparisons are by default case insensitive,
     * see `boolean.sensitive()` to change this behavior.
     * @param values - strings, numbers or arrays of them
     */
    falsy(...values: Array<string | number | null>): this;

    /**
     * Allows the values provided to truthy and falsy as well as the "true" and "false" default conversion
     * (when not in `strict()` mode) to be matched in a case insensitive manner.
     */
    sensitive(enabled?: boolean): this;

    /**
     * Allows for additional values to be considered valid booleans by converting them to true during validation.
     * String comparisons are by default case insensitive, see `boolean.sensitive()` to change this behavior.
     * @param values - strings, numbers or arrays of them
     */
    truthy(...values: Array<string | number | null>): this;
}

export interface NumberSchema<TSchema = number> extends AnySchema<TSchema> {
    /**
     * Specifies that the value must be greater than limit.
     * It can also be a reference to another field.
     */
    greater(limit: number | Reference): this;

    /**
     * Requires the number to be an integer (no floating point).
     */
    integer(): this;

    /**
     * Specifies that the value must be less than limit.
     * It can also be a reference to another field.
     */
    less(limit: number | Reference): this;

    /**
     * Specifies the maximum value.
     * It can also be a reference to another field.
     */
    max(limit: number | Reference): this;

    /**
     * Specifies the minimum value.
     * It can also be a reference to another field.
     */
    min(limit: number | Reference): this;

    /**
     * Specifies that the value must be a multiple of base.
     */
    multiple(base: number | Reference): this;

    /**
     * Requires the number to be negative.
     */
    negative(): this;

    /**
     * Requires the number to be a TCP port, so between 0 and 65535.
     */
    port(): this;

    /**
     * Requires the number to be positive.
     */
    positive(): this;

    /**
     * Specifies the maximum number of decimal places where:
     * @param limit - the maximum number of decimal places allowed.
     */
    precision(limit: number): this;

    /**
     * Requires the number to be negative or positive.
     */
    sign(sign: 'positive' | 'negative'): this;

    /**
     * Allows the number to be outside of JavaScript's safety range (Number.MIN_SAFE_INTEGER & Number.MAX_SAFE_INTEGER).
     */
    unsafe(enabled?: any): this;
}

export interface StringSchema<TSchema = string> extends AnySchema<TSchema> {
    /**
     * Requires the string value to only contain a-z, A-Z, and 0-9.
     */
    alphanum(): this;

    /**
     * Requires the string value to be a valid base64 string; does not check the decoded value.
     */
    base64(options?: Base64Options): this;

    /**
     * Sets the required string case.
     */
    case(direction: 'upper' | 'lower'): this;

    /**
     * Requires the number to be a credit card number (Using Luhn Algorithm).
     */
    creditCard(): this;

    /**
     * Requires the string value to be a valid data URI string.
     */
    dataUri(options?: DataUriOptions): this;

    /**
     * Requires the string value to be a valid domain.
     */
    domain(options?: DomainOptions): this;

    /**
     * Requires the string value to be a valid email address.
     */
    email(options?: EmailOptions): this;

    /**
     * Requires the string value to be a valid GUID.
     */
    guid(options?: GuidOptions): this;

    /**
     * Requires the string value to be a valid hexadecimal string.
     */
    hex(options?: HexOptions): this;

    /**
     * Requires the string value to be a valid hostname as per RFC1123.
     */
    hostname(): this;

    /**
     * Allows the value to match any whitelist of blacklist item in a case insensitive comparison.
     */
    insensitive(): this;

    /**
     * Requires the string value to be a valid ip address.
     */
    ip(options?: IpOptions): this;

    /**
     * Requires the string value to be in valid ISO 8601 date format.
     */
    isoDate(): this;

    /**
     * Requires the string value to be in valid ISO 8601 duration format.
     */
    isoDuration(): this;

    /**
     * Specifies the exact string length required
     * @param limit - the required string length. It can also be a reference to another field.
     * @param encoding - if specified, the string length is calculated in bytes using the provided encoding.
     */
    length(limit: number | Reference, encoding?: string): this;

    /**
     * Requires the string value to be all lowercase. If the validation convert option is on (enabled by default), the string will be forced to lowercase.
     */
    lowercase(): this;

    /**
     * Specifies the maximum number of string characters.
     * @param limit - the maximum number of string characters allowed. It can also be a reference to another field.
     * @param encoding - if specified, the string length is calculated in bytes using the provided encoding.
     */
    max(limit: number | Reference, encoding?: string): this;

    /**
     * Specifies the minimum number string characters.
     * @param limit - the minimum number of string characters required. It can also be a reference to another field.
     * @param encoding - if specified, the string length is calculated in bytes using the provided encoding.
     */
    min(limit: number | Reference, encoding?: string): this;

    /**
     * Requires the string value to be in a unicode normalized form. If the validation convert option is on (enabled by default), the string will be normalized.
     * @param [form='NFC'] - The unicode normalization form to use. Valid values: NFC [default], NFD, NFKC, NFKD
     */
    normalize(form?: 'NFC' | 'NFD' | 'NFKC' | 'NFKD'): this;

    /**
     * Defines a regular expression rule.
     * @param pattern - a regular expression object the string value must match against.
     * @param options - optional, can be:
     *   Name for patterns (useful with multiple patterns). Defaults to 'required'.
     *   An optional configuration object with the following supported properties:
     *     name - optional pattern name.
     *     invert - optional boolean flag. Defaults to false behavior. If specified as true, the provided pattern will be disallowed instead of required.
     */
    pattern(pattern: RegExp, options?: string | StringRegexOptions): this;

    /**
     * Defines a regular expression rule.
     * @param pattern - a regular expression object the string value must match against.
     * @param options - optional, can be:
     *   Name for patterns (useful with multiple patterns). Defaults to 'required'.
     *   An optional configuration object with the following supported properties:
     *     name - optional pattern name.
     *     invert - optional boolean flag. Defaults to false behavior. If specified as true, the provided pattern will be disallowed instead of required.
     */
    regex(pattern: RegExp, options?: string | StringRegexOptions): this;

    /**
     * Replace characters matching the given pattern with the specified replacement string where:
     * @param pattern - a regular expression object to match against, or a string of which all occurrences will be replaced.
     * @param replacement - the string that will replace the pattern.
     */
    replace(pattern: RegExp | string, replacement: string): this;

    /**
     * Requires the string value to only contain a-z, A-Z, 0-9, and underscore _.
     */
    token(): this;

    /**
     * Requires the string value to contain no whitespace before or after. If the validation convert option is on (enabled by default), the string will be trimmed.
     * @param [enabled=true] - optional parameter defaulting to true which allows you to reset the behavior of trim by providing a falsy value.
     */
    trim(enabled?: any): this;

    /**
     * Specifies whether the string.max() limit should be used as a truncation.
     * @param [enabled=true] - optional parameter defaulting to true which allows you to reset the behavior of truncate by providing a falsy value.
     */
    truncate(enabled?: boolean): this;

    /**
     * Requires the string value to be all uppercase. If the validation convert option is on (enabled by default), the string will be forced to uppercase.
     */
    uppercase(): this;

    /**
     * Requires the string value to be a valid RFC 3986 URI.
     */
    uri(options?: UriOptions): this;

    /**
     * Requires the string value to be a valid GUID.
     */
    uuid(options?: GuidOptions): this;
}

export interface SymbolSchema<TSchema = Symbol> extends AnySchema<TSchema> {
    map(iterable: Iterable<[string | number | boolean | symbol, symbol]> | { [key: string]: symbol }): this;
}

export interface ArraySortOptions {
    /**
     * @default 'ascending'
     */
    order?: 'ascending' | 'descending';
    by?: string | Reference;
}

export interface ArrayUniqueOptions extends HierarchySeparatorOptions {
    /**
     * if true, undefined values for the dot notation string comparator will not cause the array to fail on uniqueness.
     *
     * @default false
     */
    ignoreUndefined?: boolean;
}

export type ComparatorFunction = (a: any, b: any) => boolean;

export interface ArraySchema<TSchema = any[]> extends AnySchema<TSchema> {
    /**
     * Verifies that an assertion passes for at least one item in the array, where:
     * `schema` - the validation rules required to satisfy the assertion. If the `schema` includes references, they are resolved against
     * the array item being tested, not the value of the `ref` target.
     */
    has(schema: SchemaLike): this;

    /**
     * List the types allowed for the array values.
     * If a given type is .required() then there must be a matching item in the array.
     * If a type is .forbidden() then it cannot appear in the array.
     * Required items can be added multiple times to signify that multiple items must be found.
     * Errors will contain the number of items that didn't match.
     * Any unmatched item having a label will be mentioned explicitly.
     *
     * @param type - a joi schema object to validate each array item against.
     */
    items(...types: SchemaLikeWithoutArray[]): this;

    /**
     * Specifies the exact number of items in the array.
     */
    length(limit: number | Reference): this;

    /**
     * Specifies the maximum number of items in the array.
     */
    max(limit: number | Reference): this;

    /**
     * Specifies the minimum number of items in the array.
     */
    min(limit: number | Reference): this;

    /**
     * Lists the types in sequence order for the array values where:
     * @param type - a joi schema object to validate against each array item in sequence order. type can be multiple values passed as individual arguments.
     * If a given type is .required() then there must be a matching item with the same index position in the array.
     * Errors will contain the number of items that didn't match.
     * Any unmatched item having a label will be mentioned explicitly.
     */
    ordered(...types: SchemaLikeWithoutArray[]): this;

    /**
     * Allow single values to be checked against rules as if it were provided as an array.
     * enabled can be used with a falsy value to go back to the default behavior.
     */
    single(enabled?: any): this;

    /**
     * Sorts the array by given order.
     */
    sort(options?: ArraySortOptions): this;

    /**
     * Allow this array to be sparse.
     * enabled can be used with a falsy value to go back to the default behavior.
     */
    sparse(enabled?: any): this;

    /**
     * Requires the array values to be unique.
     * Remember that if you provide a custom comparator function,
     * different types can be passed as parameter depending on the rules you set on items.
     * Be aware that a deep equality is performed on elements of the array having a type of object,
     * a performance penalty is to be expected for this kind of operation.
     */
    unique(comparator?: string | ComparatorFunction, options?: ArrayUniqueOptions): this;
}

export interface ObjectPatternOptions {
    fallthrough?: boolean;
    matches: SchemaLike | Reference;
}

export interface ObjectSchema<TSchema = any> extends AnySchema<TSchema> {
    /**
     * Defines an all-or-nothing relationship between keys where if one of the peers is present, all of them are required as well.
     *
     * Optional settings must be the last argument.
     */
    and(...peers: Array<string | DependencyOptions>): this;

    /**
     * Appends the allowed object keys. If schema is null, undefined, or {}, no changes will be applied.
     */
    append(schema?: SchemaMap<TSchema>): this;

    append<TSchemaExtended = any, T = TSchemaExtended>(schema?: SchemaMap<T>): ObjectSchema<T>

    /**
     * Verifies an assertion where.
     */
    assert(ref: string | Reference, schema: SchemaLike, message?: string): this;

    /**
     * Requires the object to be an instance of a given constructor.
     *
     * @param constructor - the constructor function that the object must be an instance of.
     * @param name - an alternate name to use in validation errors. This is useful when the constructor function does not have a name.
     */
    // tslint:disable-next-line:ban-types
    instance(constructor: Function, name?: string): this;

    /**
     * Sets or extends the allowed object keys.
     */
    keys(schema?: SchemaMap<TSchema>): this;

    /**
     * Specifies the exact number of keys in the object.
     */
    length(limit: number): this;

    /**
     * Specifies the maximum number of keys in the object.
     */
    max(limit: number | Reference): this;

    /**
     * Specifies the minimum number of keys in the object.
     */
    min(limit: number | Reference): this;

    /**
     * Defines a relationship between keys where not all peers can be present at the same time.
     *
     * Optional settings must be the last argument.
     */
    nand(...peers: Array<string | DependencyOptions>): this;

    /**
     * Defines a relationship between keys where one of the peers is required (and more than one is allowed).
     *
     * Optional settings must be the last argument.
     */
    or(...peers: Array<string | DependencyOptions>): this;

    /**
     * Defines an exclusive relationship between a set of keys where only one is allowed but none are required.
     *
     * Optional settings must be the last argument.
     */
    oxor(...peers: Array<string | DependencyOptions>): this;

    /**
     * Specify validation rules for unknown keys matching a pattern.
     *
     * @param pattern - a pattern that can be either a regular expression or a joi schema that will be tested against the unknown key names
     * @param schema - the schema object matching keys must validate against
     */
    pattern(pattern: RegExp | SchemaLike, schema: SchemaLike, options?: ObjectPatternOptions): this;

    /**
     * Requires the object to be a Joi reference.
     */
    ref(): this;

    /**
     * Requires the object to be a `RegExp` object.
     */
    regex(): this;

    /**
     * Renames a key to another name (deletes the renamed key).
     */
    rename(from: string | RegExp, to: string, options?: RenameOptions): this;

    /**
     * Requires the object to be a Joi schema instance.
     */
    schema(type?: SchemaLike): this;

    /**
     * Overrides the handling of unknown keys for the scope of the current object only (does not apply to children).
     */
    unknown(allow?: boolean): this;

    /**
     * Requires the presence of other keys whenever the specified key is present.
     */
    with(key: string, peers: string | string[], options?: DependencyOptions): this;

    /**
     * Forbids the presence of other keys whenever the specified is present.
     */
    without(key: string, peers: string | string[], options?: DependencyOptions): this;

    /**
     * Defines an exclusive relationship between a set of keys. one of them is required but not at the same time.
     *
     * Optional settings must be the last argument.
     */
    xor(...peers: Array<string | DependencyOptions>): this;
}

export interface BinarySchema<TSchema = Buffer> extends AnySchema<TSchema> {
    /**
     * Sets the string encoding format if a string input is converted to a buffer.
     */
    encoding(encoding: string): this;

    /**
     * Specifies the minimum length of the buffer.
     */
    min(limit: number | Reference): this;

    /**
     * Specifies the maximum length of the buffer.
     */
    max(limit: number | Reference): this;

    /**
     * Specifies the exact length of the buffer:
     */
    length(limit: number | Reference): this;
}

export interface DateSchema<TSchema = Date> extends AnySchema<TSchema> {
    /**
     * Specifies that the value must be greater than date.
     * Notes: 'now' can be passed in lieu of date so as to always compare relatively to the current date,
     * allowing to explicitly ensure a date is either in the past or in the future.
     * It can also be a reference to another field.
     */
    greater(date: 'now' | Date | number | string | Reference): this;

    /**
     * Requires the string value to be in valid ISO 8601 date format.
     */
    iso(): this;

    /**
     * Specifies that the value must be less than date.
     * Notes: 'now' can be passed in lieu of date so as to always compare relatively to the current date,
     * allowing to explicitly ensure a date is either in the past or in the future.
     * It can also be a reference to another field.
     */
    less(date: 'now' | Date | number | string | Reference): this;

    /**
     * Specifies the oldest date allowed.
     * Notes: 'now' can be passed in lieu of date so as to always compare relatively to the current date,
     * allowing to explicitly ensure a date is either in the past or in the future.
     * It can also be a reference to another field.
     */
    min(date: 'now' | Date | number | string | Reference): this;

    /**
     * Specifies the latest date allowed.
     * Notes: 'now' can be passed in lieu of date so as to always compare relatively to the current date,
     * allowing to explicitly ensure a date is either in the past or in the future.
     * It can also be a reference to another field.
     */
    max(date: 'now' | Date | number | string | Reference): this;

    /**
     * Requires the value to be a timestamp interval from Unix Time.
     * @param type - the type of timestamp (allowed values are unix or javascript [default])
     */
    timestamp(type?: 'javascript' | 'unix'): this;
}

export interface FunctionSchema<TSchema = Function> extends ObjectSchema<TSchema> {
    /**
     * Specifies the arity of the function where:
     * @param n - the arity expected.
     */
    arity(n: number): this;

    /**
     * Requires the function to be a class.
     */
    class(): this;

    /**
     * Specifies the minimal arity of the function where:
     * @param n - the minimal arity expected.
     */
    minArity(n: number): this;

    /**
     * Specifies the minimal arity of the function where:
     * @param n - the minimal arity expected.
     */
    maxArity(n: number): this;
}

export interface AlternativesSchema<TSchema = any> extends AnySchema<TSchema> {
    /**
     * Adds a conditional alternative schema type, either based on another key value, or a schema peeking into the current value.
     */
    conditional(ref: string | Reference, options: WhenOptions | WhenOptions[]): this;

    conditional(ref: Schema, options: WhenSchemaOptions): this;

    /**
     * Requires the validated value to match a specific set of the provided alternative.try() schemas.
     * Cannot be combined with `alternatives.conditional()`.
     */
    match(mode: 'any' | 'all' | 'one'): this;

    /**
     * Adds an alternative schema type for attempting to match against the validated value.
     */
    try(...types: SchemaLikeWithoutArray[]): this;
}

export interface LinkSchema<TSchema = any> extends AnySchema<TSchema> {
    /**
     * Same as `any.concat()` but the schema is merged after the link is resolved which allows merging with schemas of the same type as the resolved link.
     * Will throw an exception during validation if the merged types are not compatible.
     */
    concat(schema: Schema): this;

    /**
     * Initializes the schema after constructions for cases where the schema has to be constructed first and then initialized.
     * If `ref` was not passed to the constructor, `link.ref()` must be called prior to usage.
     */
    ref(ref: string): this;
}

export interface Reference extends Exclude<ReferenceOptions, 'prefix'> {
    depth: number;
    type: string;
    key: string;
    root: string;
    path: string[];
    display: string;

    toString(): string;
}

export type ExtensionBoundSchema = Schema & SchemaInternals;

export interface RuleArgs {
    name: string;
    ref?: boolean;
    assert?: ((value: any) => boolean) | AnySchema;
    message?: string;

    /**
     * Undocumented properties
     */
    normalize?(value: any): any;
}

export type RuleMethod = (...args: any[]) => any;

export interface ExtensionRule {
    /**
     * alternative name for this rule.
     */
    alias?: string;
    /**
     * whether rule supports multiple invocations.
     */
    multi?: boolean;
    /**
     * Dual rule: converts or validates.
     */
    convert?: boolean;
    /**
     * list of arguments accepted by `method`.
     */
    args?: Array<RuleArgs | string>;
    /**
     * rule body.
     */
    method?: RuleMethod | false;

    /**
     * validation function.
     */
    validate?(value: any, helpers: any, args: Record<string, any>, options: any): any;

    /**
     * undocumented flags.
     */
    priority?: boolean;
    manifest?: boolean;
}

export interface CoerceResult {
    errors?: ErrorReport[];
    value?: any;
}

export type CoerceFunction = (value: any, helpers: CustomHelpers) => CoerceResult;

export interface CoerceObject {
    method: CoerceFunction;
    from?: string | string[];
}

export interface ExtensionFlag {
    setter?: string;
    default?: any;
}

export interface ExtensionTermManifest {
    mapped: {
        from: string;
        to: string;
    };
}

export interface ExtensionTerm {
    init: any[] | null;
    register?: any;
    manifest?: Record<string, 'schema' | 'single' | ExtensionTermManifest>;
}

export interface Extension {
    type: string | RegExp;

    args?(...args: SchemaLike[]): Schema;

    base?: Schema;
    coerce?: CoerceFunction | CoerceObject;
    flags?: Record<string, ExtensionFlag>;
    manifest?: {
        build?(obj: ExtensionBoundSchema, desc: Record<string, any>): any;
    };
    messages?: LanguageMessages | string;
    modifiers?: Record<string, (rule: any, enabled?: boolean) => any>;
    overrides?: Record<string, (value: any) => Schema>;

    prepare?(value: any, helpers: CustomHelpers): any;

    rebuild?(schema: ExtensionBoundSchema): void;

    rules?: Record<string, ExtensionRule & ThisType<SchemaInternals>>;
    terms?: Record<string, ExtensionTerm>;

    validate?(value: any, helpers: CustomHelpers): any;

    /**
     * undocumented options
     */
    cast?: Record<string, { from(value: any): any; to(value: any, helpers: CustomHelpers): any }>;
    properties?: Record<string, any>;
}

interface Err {
    toString(): string;
}
