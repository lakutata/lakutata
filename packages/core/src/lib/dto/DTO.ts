import {DataValidator} from './DataValidator.js'
import {
    DefineObjectAsDTO, GetCachedDTOSchema, GetObjectIndexSignatureSchemaByConstructor, InvalidateDTOSchemas,
    GetObjectIndexSignatureSchemaByPrototype,
    GetObjectSchemaByConstructor,
    GetObjectSchemaByPrototype
} from './ObjectSchemaValidation.js'
import {InvalidValueException} from '../../exceptions/dto/InvalidValueException.js'
import {WithCause} from '../helpers/internal/WithCause.js'
import {ValidationOptions} from '../validation/interfaces/ValidationOptions.js'
import {VLDMethods} from '../validation/VLD.js'
import {Schema} from '../validation/types/Schema.js'
import {ObjectSchema} from '../validation/interfaces/ObjectSchema.js'
import {IsSymbol} from '../helpers/IsSymbol.js'
import {As} from '../helpers/As.js'
import {ObjectConstructor} from '../helpers/ObjectConstructor.js'
import {toJsonSchema, type ToJsonSchemaOptions} from '../validation/JsonSchema.js'
import {JSONSchema} from '../../types/JSONSchema.js'

/**
 * Get DTO's object schema
 * @param target
 */
function getObjectSchema<ClassPrototype extends DTO>(target: ClassPrototype): Schema {
    return GetCachedDTOSchema(instanceSchemaCache, ObjectConstructor(target), (): Schema => {
        const indexSignatureSchema: Schema | null = GetObjectIndexSignatureSchemaByPrototype(target)
        const objectSchema: ObjectSchema<ClassPrototype> = GetObjectSchemaByPrototype(target)
        return indexSignatureSchema ? objectSchema.pattern(DTO.String(), indexSignatureSchema) : objectSchema
    })
}

/**
 * Schemas validating DTO instances (without description), per DTO class
 */
const instanceSchemaCache: WeakMap<Function, { revision: number, value: Schema }> = new WeakMap()

/**
 * Schemas returned by DTO.Schema(), per DTO class
 */
const classSchemaCache: WeakMap<Function, { revision: number, value: ObjectSchema }> = new WeakMap()

/**
 * Validate property value
 * @param instance
 * @param propertyKey
 * @param value
 */
function validatePropertyValue<U extends DTO, T = any>(instance: U, propertyKey: string | symbol, value: T): T {
    return DTO.validate({...instance, [propertyKey]: value}, getObjectSchema(instance), {noDefaults: true})[propertyKey]
}

/**
 * Return dynamic property proxy object
 * @param target
 * @param prop
 * @param receiver
 * @param validateFn
 */
function dynamicProxyProperty(target: any, prop: string | symbol, receiver: any, validateFn: () => void) {
    const propertyValue: any = Reflect.get(target, prop, receiver)
    if (!propertyValue) return propertyValue
    if (typeof propertyValue !== 'object') return typeof propertyValue === 'function' ? propertyValue.bind(target) : propertyValue
    return new Proxy(propertyValue, {
        set(target: any, p: string | symbol, value: any, receiver: any): boolean {
            const origValue: any = Reflect.get(target, p)
            try {
                const isSuccess: boolean = Reflect.set(target, p, value, receiver)
                validateFn()
                return isSuccess
            } catch (e) {
                Reflect.set(target, p, origValue, receiver)
                throw e
            }
        },
        get(target: any, p: string | symbol, receiver: any): any {
            return dynamicProxyProperty(target, p, receiver, validateFn)
        },
        deleteProperty: (target: any, prop: string | symbol): boolean => {
            const origValue: any = Reflect.get(target, prop)
            try {
                const isSuccess: boolean = Reflect.deleteProperty(target, prop)
                validateFn()
                return isSuccess
            } catch (e) {
                Reflect.set(target, prop, origValue, receiver)
                throw e
            }
        }
    })
}

const DTODescriptionSymbol: symbol = Symbol('DTO.DESCRIPTION')

/**
 * DTO base class
 */
@(<ClassConstructor extends typeof DTO>(target: ClassConstructor): ClassConstructor => DefineObjectAsDTO(target))
export class DTO extends DataValidator {

    constructor(props: Record<string, any> = {}) {
        super()
        //Create DTO proxy object
        const DTOInstanceProxy: this = new Proxy(this, {
            set: (target, prop: string | symbol, value, receiver): boolean => {
                if (!IsSymbol(prop)) value = validatePropertyValue(this, prop, value)
                return Reflect.set(target, prop, value, receiver)
            },
            get: (target: this, p: string | symbol, receiver: any): any => dynamicProxyProperty(target, p, receiver, () => DTO.validate({...this}, getObjectSchema(this), {noDefaults: true})),
            deleteProperty: (target: any, prop: string | symbol): boolean => {
                if (!IsSymbol(prop)) validatePropertyValue(this, prop, void (0))
                return Reflect.deleteProperty(target, prop)
            }
        })
        try {
            const validProps: Record<string, any> = DTO.validate(props, getObjectSchema(this))
            Object.keys(validProps).forEach((propertyKey: string) => Reflect.set(this, propertyKey, validProps[propertyKey]))

        } catch (e) {
            throw WithCause(new InvalidValueException((As<Error>(e).message)), e)
        }
        return DTOInstanceProxy
    }

    [prop: string | symbol]: any

    /**
     * Prepare schema and validate options
     * @param schemaOrOptions
     * @param options
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
     * Convert current DTO to JSONSchema (default: JSON Schema 2020-12)
     * @param version
     * @param options
     */
    public static toJsonSchema(version: 'draft-2020-12' | 'draft-2019-09' | 'draft-07' | 'draft-04' = 'draft-2020-12', options: Omit<ToJsonSchemaOptions, 'target'> = {}): JSONSchema {
        return toJsonSchema(this, {...options, target: version})
    }

    /**
     * Convert current DTO to OpenAPI JSONSchema (default: OpenAPI 3.1)
     * @param version
     * @param options
     */
    public static toOpenAPIJsonSchema(version: '3.0' | '3.1' = '3.1', options: Omit<ToJsonSchemaOptions, 'target' | 'dialect'> = {}): JSONSchema {
        return toJsonSchema(this, {...options, target: version === '3.0' ? 'openapi-3.0' : 'openapi-3.1'})
    }

    /**
     * Set description
     * @param desc
     */
    public static description(desc: string): typeof DTO {
        Reflect.defineMetadata(DTODescriptionSymbol, desc, this)
        InvalidateDTOSchemas()
        return this
    }

    /**
     * DTO schema
     * @constructor
     */
    public static Schema(): ObjectSchema {
        return GetCachedDTOSchema(classSchemaCache, this, (): ObjectSchema => {
            const objectSchema: ObjectSchema = GetObjectSchemaByConstructor(this)
            const indexSignatureSchema: Schema | null = GetObjectIndexSignatureSchemaByConstructor(this)
            const description: string | undefined = Reflect.getOwnMetadata(DTODescriptionSymbol, this)
            const finalSchema: ObjectSchema = indexSignatureSchema ? objectSchema.pattern(DTO.String(), indexSignatureSchema) : objectSchema
            return description === undefined ? finalSchema : finalSchema.description(description)
        })
    }

    /**
     * Marks DTO schema as required which will not allow undefined as value.
     */
    public static required(): ObjectSchema {
        return this.Schema().required()
    }

    /**
     * Marks a DTO schema as optional which will allow undefined as values.
     */
    public static optional(): ObjectSchema {
        return this.Schema().optional()
    }

    /**
     * Overrides the validate() options for the current key and any sub-key.
     * @param options
     */
    public static options(options: ValidationOptions): ObjectSchema {
        return this.Schema().options(options)
    }

    /**
     * Is data matched with given schema
     * @param data
     */
    public static isValid<T = any>(data: T): boolean
    /**
     * Is data matched with given schema
     * @param data
     * @param options
     */
    public static isValid<T = any>(data: T, options: ValidationOptions): boolean
    /**
     * Is data matched with given schema
     * @param data
     * @param schema
     */
    public static isValid<T = any>(data: T, schema: Schema): boolean
    /**
     * Is data matched with given schema
     * @param data
     * @param schema
     * @param options
     */
    public static isValid<T = any>(data: T, schema: Schema, options: ValidationOptions): boolean
    public static isValid<T = any>(data: T, schemaOrOptions?: Schema | ValidationOptions, validateOptions?: ValidationOptions): boolean {
        const {schema, options} = this.prepareValidation(schemaOrOptions, validateOptions)
        return VLDMethods.isValid(data, schema, options)
    }

    /**
     *
     * @param data
     */
    public static async isValidAsync<T = any>(data: T): Promise<boolean>
    /**
     * Is data matched with given schema
     * @param data
     * @param options
     */
    public static async isValidAsync<T = any>(data: T, options: ValidationOptions): Promise<boolean>
    /**
     * Is data matched with given schema
     * @param data
     * @param schema
     */
    public static async isValidAsync<T = any>(data: T, schema: Schema): Promise<boolean>
    /**
     * Is data matched with given schema
     * @param data
     * @param schema
     * @param options
     */
    public static async isValidAsync<T = any>(data: T, schema: Schema, options: ValidationOptions): Promise<boolean>
    public static async isValidAsync<T = any>(data: T, schemaOrOptions?: Schema | ValidationOptions, validateOptions?: ValidationOptions): Promise<boolean> {
        const {schema, options} = this.prepareValidation(schemaOrOptions, validateOptions)
        return await VLDMethods.isValidAsync(data, schema, options)
    }

    /**
     * Validates a value using the schema and options.
     * @param data
     */
    public static validate<T = any>(data: T): T
    /**
     * Validates a value using the schema and options.
     * @param data
     * @param options
     */
    public static validate<T = any>(data: T, options: ValidationOptions): T
    /**
     * Validates a value using the schema and options.
     * @param data
     * @param schema
     */
    public static validate<T = any>(data: T, schema: Schema): T
    /**
     * Validates a value using the schema and options.
     * @param data
     * @param schema
     * @param options
     */
    public static validate<T = any>(data: T, schema: Schema, options: ValidationOptions): T
    public static validate<T = any>(data: T, schemaOrOptions?: Schema | ValidationOptions, validateOptions?: ValidationOptions): T {
        const {schema, options} = this.prepareValidation(schemaOrOptions, validateOptions)
        return VLDMethods.validate(data, schema, options)
    }

    /**
     * Validates a value using the schema and options.
     * @param data
     */
    public static async validateAsync<T = any>(data: T): Promise<T>
    /**
     * Validates a value using the schema and options.
     * @param data
     * @param options
     */
    public static async validateAsync<T = any>(data: T, options: ValidationOptions): Promise<T>
    /**
     * Validates a value using the schema and options.
     * @param data
     * @param schema
     */
    public static async validateAsync<T = any>(data: T, schema: Schema): Promise<T>
    /**
     * Validates a value using the schema and options.
     * @param data
     * @param schema
     * @param options
     */
    public static async validateAsync<T = any>(data: T, schema: Schema, options: ValidationOptions): Promise<T>
    public static async validateAsync<T = any>(data: T, schemaOrOptions?: Schema | ValidationOptions, validateOptions?: ValidationOptions): Promise<T> {
        const {schema, options} = this.prepareValidation(schemaOrOptions, validateOptions)
        return await VLDMethods.validateAsync(data, schema, options)
    }
}
