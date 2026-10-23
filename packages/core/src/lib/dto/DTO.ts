import {DataValidator} from './DataValidator.js'
import {
    defineObjectAsDTO, getCachedDTOSchema, getObjectIndexSignatureSchemaByConstructor, invalidateDTOSchemas,
    getObjectIndexSignatureSchemaByPrototype,
    getObjectSchemaByConstructor,
    getObjectSchemaByPrototype,
    setObjectPropertySchema,
    setObjectSchemaRefinement
} from './ObjectSchemaValidation.js'
import {InvalidValueException} from '../../exceptions/dto/InvalidValueException.js'
import {withCause} from '../helpers/internal/WithCause.js'
import {ValidationOptions} from '../validation/interfaces/ValidationOptions.js'
import {VLD, VLDMethods} from '../validation/VLD.js'
import type {Base} from '../validation/engine/schema/base.js'
import {Schema} from '../validation/types/Schema.js'
import {ObjectSchema} from '../validation/interfaces/ObjectSchema.js'
import {isSymbol} from '@lakutata/utils/IsSymbol'
import {As} from '@lakutata/utils/As'
import {objectConstructor} from '@lakutata/utils/ObjectConstructor'
import {toJsonSchema, type FromJsonSchemaOptions, type ToJsonSchemaOptions} from '../validation/JsonSchema.js'
import {importObject, type ImportedObject} from '../validation/engine/json-schema/import.js'
import {SchemaConversionException} from '../validation/exceptions/SchemaConversionException.js'
import {JSONSchema} from '../../types/JSONSchema.js'
import {type CachedSchema} from './CachedSchema.js'
import {type KeysChild, type PatternTerm} from '../validation/engine/schema/types/keys.js'

/**
 * Get DTO's object schema
 * @param target
 */
function getObjectSchema<ClassPrototype extends DTO>(target: ClassPrototype): Schema {
    return getCachedDTOSchema(instanceSchemaCache, objectConstructor(target), (): Schema => {
        const indexSignatureSchema: Schema | null = getObjectIndexSignatureSchemaByPrototype(target)
        const objectSchema: ObjectSchema<ClassPrototype> = getObjectSchemaByPrototype(target)
        return indexSignatureSchema ? objectSchema.pattern(DTO.String(), indexSignatureSchema) : objectSchema
    })
}

/**
 * Schemas validating DTO instances (without description), per DTO class
 */
const instanceSchemaCache: WeakMap<Function, CachedSchema<Schema>> = new WeakMap()

/**
 * Schemas returned by DTO.Schema(), per DTO class
 */
const classSchemaCache: WeakMap<Function, CachedSchema<ObjectSchema>> = new WeakMap()

/**
 * The schemas validating a single property, per DTO class (null: the whole object is validated)
 */
const propertySchemaCache: WeakMap<Function, CachedSchema<Map<string, Schema | null>>> = new WeakMap()

/**
 * The flags of an object schema which do not constrain its properties together
 */
const PROPERTY_INDEPENDENT_FLAGS: string[] = ['presence', 'description', 'label', 'unknown']

/**
 * Whether the properties of an object schema are validated independently: no rule, dependency, rename, condition,
 * value list or reference constrains them together
 * @param objectSchema
 */
function arePropertiesIndependent(objectSchema: Base): boolean {
    const terms: Record<string, unknown> = objectSchema.$_terms
    for (const term of ['dependencies', 'renames', 'externals', 'whens', 'alterations']) {
        const value: unknown = terms[term]
        if (value && (!Array.isArray(value) || value.length)) return false
    }
    if (objectSchema._rules.length || objectSchema._valids || objectSchema._invalids) return false
    for (const [flag, value] of Object.entries(objectSchema._flags)) {
        if (!PROPERTY_INDEPENDENT_FLAGS.includes(flag) || (flag === 'unknown' && typeof value === 'object')) return false
    }
    const keys: KeysChild[] = (terms.keys || []) as KeysChild[]
    //A property referring to other properties (or referred to) is validated with them
    return keys.every(({schema}: { schema: Base }): boolean => !schema.$_rootReferences().length)
}

/**
 * The schema validating a single property of a DTO, with the same label, path and preferences as the object schema
 * (null: the property is validated with the whole object)
 * @param instance
 * @param propertyKey
 */
function getPropertySchema<U extends DTO>(instance: U, propertyKey: string): Schema | null {
    const schemas: Map<string, Schema | null> = getCachedDTOSchema(propertySchemaCache, objectConstructor(instance), (): Map<string, Schema | null> => new Map())
    let schema: Schema | null | undefined = schemas.get(propertyKey)
    if (schema !== undefined) return schema
    schema = null
    const objectSchema: Base = As<Base>(getObjectSchema(instance))
    if (arePropertiesIndependent(objectSchema)) {
        const child: KeysChild | undefined = ((objectSchema.$_terms.keys || []) as KeysChild[]).find(({key}: { key: string }): boolean => key === propertyKey)
        if (child) {
            const propertyObjectSchema: Base = As<Base>(VLD.object({[propertyKey]: child.schema}))
            schema = As<Schema>(objectSchema._preferences ? propertyObjectSchema.prefs(objectSchema._preferences) : propertyObjectSchema)
        }
    }
    schemas.set(propertyKey, schema)
    return schema
}

/**
 * Whether the properties of a DTO accept any value, per DTO class
 */
const anyValuePropertyCache: WeakMap<Function, CachedSchema<Map<string, boolean>>> = new WeakMap()

/**
 * Whether a schema accepts any value: an any schema without rule, value list, condition or external validation, so no
 * change of a value it holds can fail validation
 * @param schema
 */
function acceptsAnything(schema: Base | undefined): boolean {
    if (!schema || schema.type !== 'any' || schema._rules.length || schema._valids || schema._invalids) return false
    const terms: Record<string, unknown> = schema.$_terms
    return !['whens', 'externals'].some((term: string): boolean => Array.isArray(terms[term]) && (terms[term] as unknown[]).length > 0)
}

/**
 * Whether a property of a DTO accepts any value: declared with `DTO.Any()`, or undeclared and matched by an index
 * signature `DTO.Any()` (the transport objects of a context)
 * @param instance
 * @param propertyKey
 */
function acceptsAnyValue<U extends DTO>(instance: U, propertyKey: string | symbol): boolean {
    if (typeof propertyKey !== 'string') return false
    const properties: Map<string, boolean> = getCachedDTOSchema(anyValuePropertyCache, objectConstructor(instance), (): Map<string, boolean> => new Map())
    let accepts: boolean | undefined = properties.get(propertyKey)
    if (accepts !== undefined) return accepts
    const objectSchema: Base = As<Base>(getObjectSchema(instance))
    const child: KeysChild | undefined = ((objectSchema.$_terms.keys || []) as KeysChild[]).find(({key}: { key: string }): boolean => key === propertyKey)
    //An undeclared property: the first pattern matching its key (the index signature)
    const pattern: PatternTerm | undefined = child ? undefined : ((objectSchema.$_terms.patterns || []) as PatternTerm[]).find((each: PatternTerm): boolean => each.regex
        ? each.regex.test(propertyKey)
        : !(each.schema as Base).validate(propertyKey).error)
    accepts = acceptsAnything(child ? child.schema : pattern?.rule)
    properties.set(propertyKey, accepts)
    return accepts
}

/**
 * Whether an object is plain data: an array, an object literal, or an object without prototype (an instance of a
 * subclass of Array or Object, and the objects of another realm, count as objects of other classes)
 * @param value
 */
function isPlainData(value: object): boolean {
    const constructor: unknown = (value as {constructor?: unknown}).constructor
    if (constructor === Object || constructor === Array) return true
    return constructor === undefined && Object.getPrototypeOf(value) === null
}

/**
 * Validate property value (only the property when the properties are validated independently)
 * @param instance
 * @param propertyKey
 * @param value
 */
function validatePropertyValue<U extends DTO, T = any>(instance: U, propertyKey: string | symbol, value: T): T {
    if (typeof propertyKey === 'string') {
        const propertySchema: Schema | null = getPropertySchema(instance, propertyKey)
        if (propertySchema) return DTO.validate<Record<string, T>>({[propertyKey]: value}, propertySchema, {noDefaults: true})[propertyKey]
    }
    return DTO.validate({...instance, [propertyKey]: value}, getObjectSchema(instance), {noDefaults: true})[propertyKey]
}

/**
 * The array methods which change the array
 */
const ARRAY_MUTATORS: string[] = ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']

/**
 * Restore the items of an array (its holes included)
 * @param array
 * @param snapshot
 */
function restoreArray(array: unknown[], snapshot: unknown[]): void {
    array.length = 0
    for (let i: number = 0; i < snapshot.length; ++i) {
        if (i in snapshot) array[i] = snapshot[i]
    }
    array.length = snapshot.length
}

/**
 * The own property of an object before it is replaced: whether it existed, its value, and the length of a function
 */
type PropertyState = {
    had: boolean
    value: any
    length?: number
}

/**
 * Restore a property of an object after a rejected change: its previous value, or its absence (and the length of an
 * array)
 * @param target
 * @param prop
 * @param state
 */
function restoreProperty(target: any, prop: string | symbol, state: PropertyState): void {
    if (state.had) {
        Reflect.set(target, prop, state.value)
    } else {
        Reflect.deleteProperty(target, prop)
    }
    if (state.length !== undefined) target.length = state.length
}

/**
 * The state of a property before a change
 * @param target
 * @param prop
 */
function propertyState(target: any, prop: string | symbol): PropertyState {
    return {
        had: Object.prototype.hasOwnProperty.call(target, prop),
        value: Reflect.get(target, prop),
        length: Array.isArray(target) ? target.length : undefined
    }
}

/**
 * Return dynamic property proxy object
 * @param target
 * @param prop
 * @param receiver
 * @param validateFn
 * @param acceptsAny Whether a property of the DTO holding the value accepts any value
 * @param ownerKey The property of the DTO holding the value
 */
function dynamicProxyProperty(target: any, prop: string | symbol, receiver: any, validateFn: () => void, acceptsAny?: (key: string | symbol) => boolean, ownerKey?: string | symbol) {
    const propertyValue: any = Reflect.get(target, prop, receiver)
    if (!propertyValue) return propertyValue
    if (typeof propertyValue !== 'object') {
        if (typeof propertyValue !== 'function') return propertyValue
        //A change made by an array method is validated once it is done (its steps may be invalid), and undone if invalid
        if (Array.isArray(target) && typeof prop === 'string' && ARRAY_MUTATORS.includes(prop)) {
            return (...args: any[]): any => {
                const snapshot: any[] = target.slice()
                try {
                    const result: any = propertyValue.apply(target, args)
                    validateFn()
                    return result
                } catch (e) {
                    restoreArray(target, snapshot)
                    throw e
                }
            }
        }
        //A method is called on its object, not on the proxy (the internal slots of a Date, a Map); the function itself is
        //kept, with its own properties: an express application is a function whose methods (its own bind among them)
        //its requests read
        return new Proxy(propertyValue, {
            apply: (method: any, _thisArg: any, args: any[]): any => Reflect.apply(method, target, args)
        })
    }
    //An object of another class held by a property accepting any value is given as it is: no change of it can be
    //refused, and a proxy would break the getters reading its private fields, the internal slots of the built-ins (the
    //size of a Map) and its identity
    if (acceptsAny?.(ownerKey!) && !isPlainData(propertyValue)) return propertyValue
    return new Proxy(propertyValue, {
        set(target: any, p: string | symbol, value: any, receiver: any): boolean {
            const state: PropertyState = propertyState(target, p)
            try {
                const isSuccess: boolean = Reflect.set(target, p, value, receiver)
                validateFn()
                return isSuccess
            } catch (e) {
                restoreProperty(target, p, state)
                throw e
            }
        },
        get(target: any, p: string | symbol, receiver: any): any {
            return dynamicProxyProperty(target, p, receiver, validateFn, acceptsAny, ownerKey)
        },
        deleteProperty: (target: any, prop: string | symbol): boolean => {
            const state: PropertyState = propertyState(target, prop)
            try {
                const isSuccess: boolean = Reflect.deleteProperty(target, prop)
                validateFn()
                return isSuccess
            } catch (e) {
                restoreProperty(target, prop, state)
                throw e
            }
        }
    })
}

const DTODescriptionSymbol: symbol = Symbol('DTO.DESCRIPTION')

/**
 * The base class of the data transfer objects: a class whose properties are declared with schemas (`@Expect`), and
 * which validates its data when it is constructed and each time it is changed. Its static methods validate any value
 * (`DTO.validate()`), build schemas (`DTO.String()`, `DTO.Object()`…), and convert the class schema to or from JSON
 * Schema. A DTO class is also a schema wherever one is expected: `@Accept`, `@Return`, the input of the controller
 * actions. The schemas built by `DTO` are strict: a value of the wrong type is rejected, not converted (the string `'5'`
 * is not the number 5).
 * @example
 * ```typescript
 * import {DTO} from 'lakutata'
 * import {Expect} from 'lakutata/decorator/dto'
 *
 * class AddressDTO extends DTO {
 *     @Expect(DTO.String().required())
 *     public city!: string
 *
 *     @Expect(DTO.String().pattern(/^[0-9]{5}$/).optional())
 *     public zip?: string
 * }
 *
 * class CustomerDTO extends DTO {
 *     @Expect(DTO.String().min(1).required())
 *     public name!: string
 *
 *     @Expect(AddressDTO.required())
 *     public address!: AddressDTO
 * }
 *
 * //Validated when constructed, the unknown key "note" removed
 * const customer: CustomerDTO = new CustomerDTO({name: 'Ada', address: {city: 'London'}, note: 'vip'})
 * //Validated without an instance: the validated value, or an InvalidValueException
 * const data: CustomerDTO = CustomerDTO.validate({name: 'Ada', address: {city: 'London'}})
 * //Checked without exception
 * console.log(customer.name, data.address.city, CustomerDTO.isValid({name: ''}))
 * ```
 */
@(<ClassConstructor extends typeof DTO>(target: ClassConstructor): ClassConstructor => defineObjectAsDTO(target))
export class DTO extends DataValidator {

    /**
     * Create a DTO from its data, validated against the class schema: the defaults applied, the keys without schema
     * removed (unless the class has an `@IndexSignature`). The instance then validates each change of a property, or
     * of a value nested in it (an array, an object): an invalid change throws an `InvalidValueException` and is
     * undone. A property accepting any value (`DTO.Any()`, or an index signature `DTO.Any()`) gives the objects of
     * other classes it holds as they are, since no change of theirs can be invalid: their getters, their private fields
     * and their identity are those of the object itself.
     * @param props The data of the DTO. Default: no data (`{}`).
     * @throws {InvalidValueException} When the data does not match the class schema.
     */
    constructor(props: Record<string, any> = {}) {
        super()
        //Whether each property accepts any value, remembered by the instance once known
        let accepting: Record<string, boolean> | undefined
        const acceptsAny = (key: string | symbol): boolean => {
            if (typeof key !== 'string') return false
            accepting ??= Object.create(null) as Record<string, boolean>
            return accepting[key] ??= acceptsAnyValue(this, key)
        }
        //Create DTO proxy object
        const DTOInstanceProxy: this = new Proxy(this, {
            set: (target, prop: string | symbol, value, receiver): boolean => {
                if (!isSymbol(prop)) value = validatePropertyValue(this, prop, value)
                return Reflect.set(target, prop, value, receiver)
            },
            get: (target: this, p: string | symbol, receiver: any): any => dynamicProxyProperty(target, p, receiver, (): void => {
                //A nested change is validated with the property holding it
                if (isSymbol(p)) {
                    DTO.validate({...this}, getObjectSchema(this), {noDefaults: true})
                } else {
                    validatePropertyValue(this, p, Reflect.get(target, p))
                }
            }, acceptsAny, p),
            deleteProperty: (target: any, prop: string | symbol): boolean => {
                if (!isSymbol(prop)) validatePropertyValue(this, prop, void (0))
                return Reflect.deleteProperty(target, prop)
            }
        })
        try {
            const validProps: Record<string, any> = DTO.validate(props, getObjectSchema(this))
            Object.keys(validProps).forEach((propertyKey: string) => Reflect.set(this, propertyKey, validProps[propertyKey]))

        } catch (e) {
            throw withCause(new InvalidValueException((As<Error>(e).message)), e)
        }
        return DTOInstanceProxy
    }

    [prop: string | symbol]: any

    /**
     * Resolve the arguments of the validation methods: the schema given, else the class schema (`this.Schema()`), and
     * the validation options.
     * @param schemaOrOptions The schema to validate against, or the validation options when no schema is given.
     * @param options The validation options, when a schema is given. Default: no option (`{}`).
     * @returns The schema and the options to validate with.
     * @protected
     */
    protected static prepareValidation(schemaOrOptions?: Schema | ValidationOptions, options?: ValidationOptions): {
        schema: Schema
        options: ValidationOptions
    } {
        const schema: Schema = schemaOrOptions ? VLDMethods.isSchema(schemaOrOptions) ? As<Schema>(schemaOrOptions) : this.Schema() : this.Schema()
        const validateOptions: ValidationOptions = options ? options : schemaOrOptions ? VLDMethods.isSchema(schemaOrOptions) ? {} : As<ValidationOptions>(schemaOrOptions) : {}
        return {
            schema: schema,
            options: validateOptions
        }
    }

    /**
     * Convert the class schema to a JSON Schema, for an API document or another validator. What JSON Schema cannot
     * express (custom rules, references to other values) is dropped, so the JSON Schema may accept more values, never
     * less.
     * @param version The JSON Schema version to write. Default `'draft-2020-12'`.
     * @param options The validation options the schema is used with, whether `$schema` is written, and the object
     * receiving the shared schemas. Default: no option (`{}`).
     * @returns A new JSON Schema.
     * @throws {SchemaConversionException} When the version is unknown.
     */
    public static toJsonSchema(version: 'draft-2020-12' | 'draft-2019-09' | 'draft-07' | 'draft-04' = 'draft-2020-12', options: Omit<ToJsonSchemaOptions, 'target'> = {}): JSONSchema {
        return toJsonSchema(this, {...options, target: version})
    }

    /**
     * Convert the class schema to an OpenAPI schema object, for the `components.schemas` of an OpenAPI document.
     * @param version The OpenAPI version: `'3.0'` or `'3.1'`. Default `'3.1'`.
     * @param options The validation options the schema is used with, and the object receiving the shared schemas.
     * Default: no option (`{}`).
     * @returns A new OpenAPI schema object.
     */
    public static toOpenAPIJsonSchema(version: '3.0' | '3.1' = '3.1', options: Omit<ToJsonSchemaOptions, 'target' | 'dialect'> = {}): JSONSchema {
        return toJsonSchema(this, {...options, target: version === '3.0' ? 'openapi-3.0' : 'openapi-3.1'})
    }

    /**
     * Create a DTO class (a subclass of the current DTO class) from an object JSON Schema (or an OpenAPI schema object),
     * validating like JSON Schema: its properties become the properties of the DTO, its other keywords (unknown keys,
     * pattern properties, key counts, dependencies, subschemas) constrain the whole object.
     * @param schema The JSON Schema of an object (or an OpenAPI schema object), or a reference (`$ref`) to one.
     * @param options The version of the JSON Schema, where its references are resolved, whether the values are
     * converted, and the name of the class. Default `name`: the title of the JSON Schema, else the current class
     * name followed by `FromJsonSchema`.
     * @returns The new DTO class.
     * @throws {SchemaConversionException} When the JSON Schema does not describe objects, a reference cannot be
     * resolved, or a pattern is not a valid regular expression.
     */
    public static fromJsonSchema<T extends typeof DTO>(this: T, schema: JSONSchema, options: FromJsonSchemaOptions & { name?: string } = {}): T {
        const imported: ImportedObject = importObject(schema, options)
        const BaseDTO: typeof DTO = this
        const name: string = options.name || imported.title || `${BaseDTO.name}FromJsonSchema`
        //A named subclass
        const GeneratedDTO: T = As<T>({[name]: class extends BaseDTO {}}[name])
        for (const [propertyKey, propertySchema] of Object.entries(imported.keys)) setObjectPropertySchema(GeneratedDTO.prototype, propertyKey, As<Schema>(propertySchema))
        setObjectSchemaRefinement(GeneratedDTO, (objectSchema: ObjectSchema): ObjectSchema => As<ObjectSchema>(imported.refine(As(objectSchema))))
        if (imported.description) GeneratedDTO.description(imported.description)
        return GeneratedDTO
    }

    /**
     * Create the DTO classes of the object schemas of an OpenAPI document (its components.schemas), by name; the
     * references between the schemas are resolved in the document. The schemas which do not describe objects are
     * skipped.
     * @param document The OpenAPI 3.0 or 3.1 document.
     * @param options How the JSON Schemas are read. Default `dialect`: the version of the document's `openapi` field.
     * @returns The DTO classes, by the names of their schemas.
     * @throws {SchemaConversionException} When the document has no `components.schemas`, or a schema cannot be
     * converted.
     */
    public static fromOpenAPI<T extends typeof DTO>(this: T, document: Record<string, unknown>, options: Omit<FromJsonSchemaOptions, 'document'> = {}): Record<string, T> {
        const version: unknown = document.openapi
        const dialect: FromJsonSchemaOptions['dialect'] = options.dialect || (typeof version === 'string' && version.startsWith('3.0') ? 'openapi-3.0' : 'openapi-3.1')
        const components: unknown = (document.components as Record<string, unknown> | undefined)?.schemas
        if (!components || typeof components !== 'object') throw new SchemaConversionException('The OpenAPI document has no schemas')
        const result: Record<string, T> = {}
        for (const [name, component] of Object.entries(components)) {
            //Only the schemas of objects are classes
            if (!component || typeof component !== 'object') continue
            const type: unknown = (component as JSONSchema).type
            if (type !== undefined && type !== 'object') continue
            const pointer: string = `#/components/schemas/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`
            result[name] = this.fromJsonSchema({$ref: pointer}, {...options, dialect, document, name})
        }
        return result
    }

    /**
     * Set the description of the class schema, written into its JSON Schema and its descriptions. The description is
     * not inherited by the subclasses.
     * @param desc The description.
     * @returns The class itself, for chaining.
     */
    public static description(desc: string): typeof DTO {
        Reflect.defineMetadata(DTODescriptionSymbol, desc, this)
        invalidateDTOSchemas()
        return this
    }

    /**
     * Get the class schema: an object schema of the properties declared with `@Expect` (the parents' included), with
     * the `@IndexSignature` and the description of the class. The schema is optional (it accepts `undefined`): use
     * `required()` for a required one.
     * @returns The object schema; the same instance until a schema declaration changes.
     */
    public static Schema(): ObjectSchema {
        return getCachedDTOSchema(classSchemaCache, this, (): ObjectSchema => {
            const objectSchema: ObjectSchema = getObjectSchemaByConstructor(this)
            const indexSignatureSchema: Schema | null = getObjectIndexSignatureSchemaByConstructor(this)
            const description: string | undefined = Reflect.getOwnMetadata(DTODescriptionSymbol, this)
            const finalSchema: ObjectSchema = indexSignatureSchema ? objectSchema.pattern(DTO.String(), indexSignatureSchema) : objectSchema
            return description === undefined ? finalSchema : finalSchema.description(description)
        })
    }

    /**
     * Get the class schema marked as required: `undefined` is rejected.
     * @returns A new object schema.
     */
    public static required(): ObjectSchema {
        return this.Schema().required()
    }

    /**
     * Get the class schema marked as optional: `undefined` is accepted (as by `Schema()`).
     * @returns A new object schema.
     */
    public static optional(): ObjectSchema {
        return this.Schema().optional()
    }

    /**
     * Get the class schema with its own validation options, which override the options of the validation for the
     * object and its nested values.
     * @param options The validation options.
     * @returns A new object schema.
     */
    public static options(options: ValidationOptions): ObjectSchema {
        return this.Schema().options(options)
    }

    /**
     * Check whether a value matches a schema (the class schema when none is given), without throwing.
     * @param data The value to check.
     * @returns `true` when the value matches the schema, else `false`.
     */
    public static isValid<T = any>(data: T): boolean
    /**
     * Check whether a value matches a schema (the class schema when none is given), without throwing.
     * @param data The value to check.
     * @param options The validation options, merged with the defaults (unknown keys removed, the first error only).
     * @returns `true` when the value matches the schema, else `false`.
     */
    public static isValid<T = any>(data: T, options: ValidationOptions): boolean
    /**
     * Check whether a value matches a schema (the class schema when none is given), without throwing.
     * @param data The value to check.
     * @param schema The schema to check against, instead of the class schema.
     * @returns `true` when the value matches the schema, else `false`.
     */
    public static isValid<T = any>(data: T, schema: Schema): boolean
    /**
     * Check whether a value matches a schema (the class schema when none is given), without throwing.
     * @param data The value to check.
     * @param schema The schema to check against, instead of the class schema.
     * @param options The validation options, merged with the defaults (unknown keys removed, the first error only).
     * @returns `true` when the value matches the schema, else `false`.
     */
    public static isValid<T = any>(data: T, schema: Schema, options: ValidationOptions): boolean
    public static isValid<T = any>(data: T, schemaOrOptions?: Schema | ValidationOptions, validateOptions?: ValidationOptions): boolean {
        const {schema, options} = this.prepareValidation(schemaOrOptions, validateOptions)
        return VLDMethods.isValid(data, schema, options)
    }

    /**
     * Check whether a value matches a schema (the class schema when none is given), without throwing; asynchronously,
     * running the external rules of the schema.
     * @param data The value to check.
     * @returns A promise of `true` when the value matches the schema, else `false`.
     */
    public static async isValidAsync<T = any>(data: T): Promise<boolean>
    /**
     * Check whether a value matches a schema (the class schema when none is given), without throwing; asynchronously,
     * running the external rules of the schema.
     * @param data The value to check.
     * @param options The validation options, merged with the defaults (unknown keys removed, the first error only).
     * @returns A promise of `true` when the value matches the schema, else `false`.
     */
    public static async isValidAsync<T = any>(data: T, options: ValidationOptions): Promise<boolean>
    /**
     * Check whether a value matches a schema (the class schema when none is given), without throwing; asynchronously,
     * running the external rules of the schema.
     * @param data The value to check.
     * @param schema The schema to check against, instead of the class schema.
     * @returns A promise of `true` when the value matches the schema, else `false`.
     */
    public static async isValidAsync<T = any>(data: T, schema: Schema): Promise<boolean>
    /**
     * Check whether a value matches a schema (the class schema when none is given), without throwing; asynchronously,
     * running the external rules of the schema.
     * @param data The value to check.
     * @param schema The schema to check against, instead of the class schema.
     * @param options The validation options, merged with the defaults (unknown keys removed, the first error only).
     * @returns A promise of `true` when the value matches the schema, else `false`.
     */
    public static async isValidAsync<T = any>(data: T, schema: Schema, options: ValidationOptions): Promise<boolean>
    public static async isValidAsync<T = any>(data: T, schemaOrOptions?: Schema | ValidationOptions, validateOptions?: ValidationOptions): Promise<boolean> {
        const {schema, options} = this.prepareValidation(schemaOrOptions, validateOptions)
        return await VLDMethods.isValidAsync(data, schema, options)
    }

    /**
     * Validate a value against a schema (the class schema when none is given).
     * @param data The value to check.
     * @returns The validated value: the defaults applied, the unknown keys removed (a plain object, not a DTO instance).
     * @throws {InvalidValueException} When the value does not match the schema (its cause holds the details).
     */
    public static validate<T = any>(data: T): T
    /**
     * Validate a value against a schema (the class schema when none is given).
     * @param data The value to check.
     * @param options The validation options, merged with the defaults (unknown keys removed, the first error only).
     * @returns The validated value: the defaults applied, the unknown keys removed (a plain object, not a DTO instance).
     * @throws {InvalidValueException} When the value does not match the schema (its cause holds the details).
     */
    public static validate<T = any>(data: T, options: ValidationOptions): T
    /**
     * Validate a value against a schema (the class schema when none is given).
     * @param data The value to check.
     * @param schema The schema to check against, instead of the class schema.
     * @returns The validated value: the defaults applied, the unknown keys removed (a plain object, not a DTO instance).
     * @throws {InvalidValueException} When the value does not match the schema (its cause holds the details).
     */
    public static validate<T = any>(data: T, schema: Schema): T
    /**
     * Validate a value against a schema (the class schema when none is given).
     * @param data The value to check.
     * @param schema The schema to check against, instead of the class schema.
     * @param options The validation options, merged with the defaults (unknown keys removed, the first error only).
     * @returns The validated value: the defaults applied, the unknown keys removed (a plain object, not a DTO instance).
     * @throws {InvalidValueException} When the value does not match the schema (its cause holds the details).
     */
    public static validate<T = any>(data: T, schema: Schema, options: ValidationOptions): T
    public static validate<T = any>(data: T, schemaOrOptions?: Schema | ValidationOptions, validateOptions?: ValidationOptions): T {
        const {schema, options} = this.prepareValidation(schemaOrOptions, validateOptions)
        return VLDMethods.validate(data, schema, options)
    }

    /**
     * Validate a value against a schema (the class schema when none is given), asynchronously: the external rules of
     * the schema (`.external()`) run, which the synchronous validation cannot run.
     * @param data The value to check.
     * @returns A promise of the validated value: the defaults applied, the unknown keys removed (a plain object, not a DTO
     * instance).
     * @throws {InvalidValueException} When the value does not match the schema (the promise rejects; its cause holds
     * the details).
     */
    public static async validateAsync<T = any>(data: T): Promise<T>
    /**
     * Validate a value against a schema (the class schema when none is given), asynchronously: the external rules of
     * the schema (`.external()`) run, which the synchronous validation cannot run.
     * @param data The value to check.
     * @param options The validation options, merged with the defaults (unknown keys removed, the first error only).
     * @returns A promise of the validated value: the defaults applied, the unknown keys removed (a plain object, not a DTO
     * instance).
     * @throws {InvalidValueException} When the value does not match the schema (the promise rejects; its cause holds
     * the details).
     */
    public static async validateAsync<T = any>(data: T, options: ValidationOptions): Promise<T>
    /**
     * Validate a value against a schema (the class schema when none is given), asynchronously: the external rules of
     * the schema (`.external()`) run, which the synchronous validation cannot run.
     * @param data The value to check.
     * @param schema The schema to check against, instead of the class schema.
     * @returns A promise of the validated value: the defaults applied, the unknown keys removed (a plain object, not a DTO
     * instance).
     * @throws {InvalidValueException} When the value does not match the schema (the promise rejects; its cause holds
     * the details).
     */
    public static async validateAsync<T = any>(data: T, schema: Schema): Promise<T>
    /**
     * Validate a value against a schema (the class schema when none is given), asynchronously: the external rules of
     * the schema (`.external()`) run, which the synchronous validation cannot run.
     * @param data The value to check.
     * @param schema The schema to check against, instead of the class schema.
     * @param options The validation options, merged with the defaults (unknown keys removed, the first error only).
     * @returns A promise of the validated value: the defaults applied, the unknown keys removed (a plain object, not a DTO
     * instance).
     * @throws {InvalidValueException} When the value does not match the schema (the promise rejects; its cause holds
     * the details).
     */
    public static async validateAsync<T = any>(data: T, schema: Schema, options: ValidationOptions): Promise<T>
    public static async validateAsync<T = any>(data: T, schemaOrOptions?: Schema | ValidationOptions, validateOptions?: ValidationOptions): Promise<T> {
        const {schema, options} = this.prepareValidation(schemaOrOptions, validateOptions)
        return await VLDMethods.validateAsync(data, schema, options)
    }
}
