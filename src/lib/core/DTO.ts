import {DataValidator} from '../base/internal/DataValidator.js'
import {AppendAsyncConstructor} from '../base/async-constructor/Append.js'
import {
    DefineObjectAsDTO, GetObjectIndexSignatureSchemaByConstructor,
    GetObjectIndexSignatureSchemaByPrototype,
    GetObjectPropertySchemas,
    GetObjectSchemaByConstructor,
    GetObjectSchemaByPrototype,
    ObjectPropertySchemaMap
} from '../base/internal/ObjectSchemaValidation.js'
import {InvalidValueException} from '../../exceptions/dto/InvalidValueException.js'
import {As} from '../base/func/As.js'
import {IsNativeFunction} from '../base/func/IsNativeFunction.js'
import {DTO_INSTANTIATED} from '../../constants/metadata-keys/DTOMetadataKey.js'
import {IsSymbol} from '../base/func/IsSymbol.js'
import {ValidationOptions} from '../validation/interfaces/ValidationOptions.js'
import {VLDMethods} from '../validation/VLD.js'
import {Schema} from '../validation/types/Schema.js'
import {ObjectSchema} from '../validation/interfaces/ObjectSchema.js'

/**
 * Mark DTO as instantiated
 * @param target
 */
function markInstantiated<ClassPrototype extends DTO>(target: ClassPrototype): void {
    return Reflect.defineMetadata(DTO_INSTANTIATED, true, target)
}

/**
 * Whether DTO is instantiated or not
 * @param target
 */
function isInstantiated<ClassPrototype extends DTO>(target: ClassPrototype): boolean {
    return !!Reflect.getOwnMetadata(DTO_INSTANTIATED, target)
}

/**
 * Get DTO's object schema
 * @param target
 */
function getObjectSchema<ClassPrototype extends DTO>(target: ClassPrototype): Schema {
    const indexSignatureSchema: Schema | null = GetObjectIndexSignatureSchemaByPrototype(target)
    const objectSchema: ObjectSchema<ClassPrototype> = GetObjectSchemaByPrototype(target)
    return indexSignatureSchema ? objectSchema.pattern(DTO.String(), indexSignatureSchema) : objectSchema
    // return GetObjectSchemaByPrototype(target).pattern(DTO.String(), GetObjectIndexSignatureSchemaByPrototype(target))
}

/**
 * DTO base class
 */
@(<ClassConstructor extends typeof DTO>(target: ClassConstructor) => DefineObjectAsDTO(target))
export class DTO extends DataValidator {

    constructor(props: Record<string, any> = {}, async: boolean = false) {
        super()
        //Create DTO proxy object
        const DTOInstanceProxy: this = new Proxy(this, {
            set: (target, prop: string | symbol, value, receiver): boolean => {
                if (isInstantiated(this) && !IsSymbol(prop)) {
                    prop = As<string>(prop)
                    const objectPropertySchemaMap: ObjectPropertySchemaMap = GetObjectPropertySchemas(this)
                    const indexSignatureSchema: Schema | null = GetObjectIndexSignatureSchemaByPrototype(this)
                    const propertySchema: Schema | undefined = objectPropertySchemaMap.get(prop)
                    let tmpObj: Record<string, any> = {}
                    tmpObj[prop] = value
                    if (propertySchema) {
                        value = DTO.validate(value, propertySchema, {noDefaults: true})
                    } else {
                        tmpObj = DTO.validate(tmpObj, DTO.Object().pattern(DTO.String(), indexSignatureSchema ? indexSignatureSchema : DTO.Any()), {noDefaults: true})
                        value = tmpObj[prop]
                    }
                }
                return Reflect.set(target, prop, value, receiver)
            },
            deleteProperty: (target: any, prop: string | symbol): boolean => {
                if (isInstantiated(this) && !IsSymbol(prop) && !IsNativeFunction(target[prop])) {
                    prop = As<string>(prop)
                    const objectPropertySchemaMap: ObjectPropertySchemaMap = GetObjectPropertySchemas(this)
                    const propertySchema: Schema | undefined = objectPropertySchemaMap.get(prop)
                    if (propertySchema) DTO.validate(undefined, propertySchema, {noDefaults: true})
                }
                return Reflect.deleteProperty(target, prop)
            }
        })
        if (async) {
            AppendAsyncConstructor(DTOInstanceProxy, async (): Promise<void> => {
                try {
                    const validProps: Record<string, any> = await DTO.validateAsync(props, getObjectSchema(this))
                    Object.keys(validProps).forEach((propertyKey: string) => this[propertyKey] = validProps[propertyKey])
                } catch (e) {
                    throw new InvalidValueException((As<Error>(e).message))
                }
                markInstantiated(this)
            })
        } else {
            try {
                const validProps: Record<string, any> = DTO.validate(props, getObjectSchema(this))
                Object.keys(validProps).forEach((propertyKey: string) => this[propertyKey] = validProps[propertyKey])
            } catch (e) {
                throw new InvalidValueException((As<Error>(e).message))
            }
            markInstantiated(this)
            return DTOInstanceProxy
        }
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
     * DTO schema
     * @constructor
     */
    public static Schema(): ObjectSchema {
        const objectSchema: ObjectSchema = GetObjectSchemaByConstructor(this)
        const indexSignatureSchema: Schema | null = GetObjectIndexSignatureSchemaByConstructor(this)
        return indexSignatureSchema ? objectSchema.pattern(DTO.String(), indexSignatureSchema) : objectSchema
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
