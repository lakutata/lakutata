import {DataValidator} from '../base/internal/DataValidator.js'
import {AppendAsyncConstructor} from '../base/async-constructor/Append.js'
import {
    DefineObjectAsDTO,
    GetObjectIndexSignatureSchemaByPrototype,
    GetObjectPropertySchemasByPrototype,
    GetObjectSchemaByConstructor,
    GetObjectSchemaByPrototype,
    GetObjectValidateOptions,
    ObjectPropertySchemaMap
} from '../base/internal/ObjectSchemaValidation.js'
import {InvalidValueException} from '../../exceptions/dto/InvalidValueException.js'
import {As} from '../base/func/As.js'
import {IsNativeFunction} from '../base/func/IsNativeFunction.js'
import {DTO_INSTANTIATED} from '../../constants/metadata-keys/DTOMetadataKey.js'
import {IsSymbol} from '../base/func/IsSymbol.js'
import {ValidationOptions} from '../validation/interfaces/ValidationOptions.js'
import {VLD, VLDMethods} from '../validation/VLD.js'
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
    return GetObjectSchemaByPrototype(target).pattern(DTO.String(), GetObjectIndexSignatureSchemaByPrototype(target)).options(GetObjectValidateOptions(target))
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
                    const objectPropertySchemaMap: ObjectPropertySchemaMap = GetObjectPropertySchemasByPrototype(this)
                    const indexSignatureSchema: Schema = GetObjectIndexSignatureSchemaByPrototype(this)
                    const propertySchema: Schema | undefined = objectPropertySchemaMap.get(prop)
                    let tmpObj: Record<string, any> = {}
                    tmpObj[prop] = value
                    if (propertySchema) {
                        value = DTO.validate(value, propertySchema, {
                            ...GetObjectValidateOptions(this),
                            noDefaults: true
                        })
                    } else {
                        tmpObj = DTO.validate(tmpObj, DTO.Object().pattern(DTO.String(), indexSignatureSchema), {
                            ...GetObjectValidateOptions(this),
                            noDefaults: true
                        })
                        value = tmpObj[prop]
                    }
                }
                return Reflect.set(target, prop, value, receiver)
            },
            deleteProperty: (target, prop: string | symbol): boolean => {
                if (isInstantiated(this) && !IsSymbol(prop) && !IsNativeFunction(target[prop])) {
                    prop = As<string>(prop)
                    const objectPropertySchemaMap: ObjectPropertySchemaMap = GetObjectPropertySchemasByPrototype(this)
                    const propertySchema: Schema | undefined = objectPropertySchemaMap.get(prop)
                    if (propertySchema) DTO.validate(undefined, propertySchema, {
                        ...GetObjectValidateOptions(this),
                        noDefaults: true
                    })
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
     * DTO schema
     * @constructor
     */
    public static Schema(): ObjectSchema {
        return GetObjectSchemaByConstructor(this)
    }

    /**
     * Is data matched with given schema
     * @param data
     * @param schema
     * @param options
     */
    public static isValid<T = any>(data: T, schema: Schema, options: ValidationOptions = {}): boolean {
        return VLDMethods.isValid(data, schema, options)
    }

    /**
     * Is data matched with given schema
     * @param data
     * @param schema
     * @param options
     */
    public static async isValidAsync<T = any>(data: T, schema: Schema, options: ValidationOptions = {}): Promise<boolean> {
        return await VLDMethods.isValidAsync(data, schema, options)
    }

    /**
     * Validates a value using the schema and options.
     * @param data
     * @param schema
     * @param options
     */
    public static validate<T = any>(data: T, schema: Schema, options: ValidationOptions = {}): T {
        return VLDMethods.validate(data, schema, options)
    }

    /**
     * Validates a value using the schema and options.
     * @param data
     * @param schema
     * @param options
     */
    public static async validateAsync<T = any>(data: T, schema: Schema, options: ValidationOptions = {}): Promise<T> {
        return await VLDMethods.validateAsync(data, schema, options)
    }
}
