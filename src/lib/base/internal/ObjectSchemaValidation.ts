import {DTO} from '../../core/DTO.js'
import {ObjectSchema, Schema, SchemaMap, ValidationOptions} from 'joi'
import {ObjectConstructor} from '../func/ObjectConstructor.js'
import {
    DTO_CONSTRUCTOR,
    DTO_INDEX_SIGNATURE_SCHEMA,
    DTO_PROPERTY_SCHEMAS,
    DTO_VALIDATE_OPTIONS
} from '../../../constants/metadata-keys/DTOMetadataKey.js'
import {ObjectParentConstructors} from '../func/ObjectParentConstructors.js'
import {ObjectPrototype} from '../func/ObjectPrototype.js'
import {DataValidator, DefaultValidationOptions} from './DataValidator.js'

export type ObjectPropertySchemaMap = Map<string, Schema>

/**
 * Define DTO
 * @param target
 * @constructor
 */
export function DefineObjectAsDTO<ClassConstructor extends typeof DTO>(target: ClassConstructor): ClassConstructor {
    Reflect.defineMetadata(DTO_CONSTRUCTOR, true, target)
    return target
}

/**
 * Check the target constructor is DTO constructor or not
 * @param target
 * @constructor
 */
export function IsDTO<ClassConstructor extends typeof DTO>(target: ClassConstructor): boolean {
    return !!Reflect.getMetadata(DTO_CONSTRUCTOR, target)
}

/**
 * Set object index signature schema
 * @param target
 * @param schema
 * @constructor
 */
export function SetObjectIndexSignatureSchema<ClassConstructor extends typeof DTO>(target: ClassConstructor, schema: Schema): ClassConstructor {
    Reflect.defineMetadata(DTO_INDEX_SIGNATURE_SCHEMA, schema, target)
    return target
}

/**
 * Get object's index signature schema by its prototype
 * @param target
 * @constructor
 */
export function GetObjectIndexSignatureSchemaByPrototype<ClassPrototype extends DTO>(target: ClassPrototype): Schema {
    if (Reflect.hasOwnMetadata(DTO_INDEX_SIGNATURE_SCHEMA, ObjectConstructor(target))) return Reflect.getOwnMetadata(DTO_INDEX_SIGNATURE_SCHEMA, ObjectConstructor(target))
    for (const parentConstructor of ObjectParentConstructors(ObjectConstructor(target))) {
        if (Reflect.hasOwnMetadata(DTO_INDEX_SIGNATURE_SCHEMA, parentConstructor)) return Reflect.getOwnMetadata(DTO_INDEX_SIGNATURE_SCHEMA, parentConstructor)
    }
    return DataValidator.Any()
}

/**
 * Get object's index signature schema by its constructor
 * @param target
 * @constructor
 */
export function GetObjectIndexSignatureSchemaByConstructor<ClassConstructor extends typeof DTO>(target: ClassConstructor): Schema {
    return GetObjectIndexSignatureSchemaByPrototype(ObjectPrototype(target))
}

/**
 * Set data validation schema to object's property
 * @param target
 * @param propertyKey
 * @param schema
 * @constructor
 */
export function SetObjectPropertySchema<ClassPrototype extends DTO>(target: ClassPrototype, propertyKey: string | symbol, schema: Schema): void {
    if (typeof propertyKey === 'symbol') return
    let objectPropertySchemaMap: ObjectPropertySchemaMap
    if (Reflect.hasOwnMetadata(DTO_PROPERTY_SCHEMAS, ObjectConstructor(target))) {
        objectPropertySchemaMap = Reflect.getOwnMetadata(DTO_PROPERTY_SCHEMAS, ObjectConstructor(target))
    } else {
        objectPropertySchemaMap = new Map()
        const parentObjectPropertySchemaMaps: (typeof objectPropertySchemaMap)[] = []
        ObjectParentConstructors(ObjectConstructor(target)).forEach((parentConstructor: Function): void => {
            if (Reflect.hasOwnMetadata(DTO_PROPERTY_SCHEMAS, parentConstructor))
                parentObjectPropertySchemaMaps.unshift(Reflect.getOwnMetadata(DTO_PROPERTY_SCHEMAS, parentConstructor))
        })
        parentObjectPropertySchemaMaps.forEach((parentObjectInjectionMap: typeof objectPropertySchemaMap): void =>
            parentObjectInjectionMap.forEach((value: Schema, key: typeof propertyKey) => objectPropertySchemaMap.set(key, value)))
    }
    objectPropertySchemaMap.set(propertyKey, schema)
    Reflect.defineMetadata(DTO_PROPERTY_SCHEMAS, objectPropertySchemaMap, ObjectConstructor(target))
}

/**
 * Get object's property schemas by its prototype
 * @param target
 * @constructor
 */
export function GetObjectPropertySchemasByPrototype<ClassPrototype extends DTO>(target: ClassPrototype): ObjectPropertySchemaMap {
    const objectPropertySchemaMap: ObjectPropertySchemaMap = Reflect.getOwnMetadata(DTO_PROPERTY_SCHEMAS, ObjectConstructor(target))
    if (objectPropertySchemaMap) return objectPropertySchemaMap
    return new Map()
}

/**
 * Get object's property schemas by its constructor
 * @param target
 * @constructor
 */
export function GetObjectPropertySchemasByConstructor<ClassConstructor extends typeof DTO>(target: ClassConstructor): ObjectPropertySchemaMap {
    return GetObjectPropertySchemasByPrototype(ObjectPrototype(target))
}

/**
 * Get DTO object schema by its prototype
 * @param target
 * @constructor
 */
export function GetObjectSchemaByPrototype<ClassPrototype extends DTO>(target: ClassPrototype): ObjectSchema {
    const schemaMap: SchemaMap = {}
    GetObjectPropertySchemasByPrototype(target).forEach((propertySchema: Schema, propertyKey: string): void => {
        schemaMap[propertyKey] = propertySchema
    })
    return DataValidator.Object(schemaMap)
}

/**
 * Get DTO object schema by its constructor
 * @param target
 * @constructor
 */
export function GetObjectSchemaByConstructor<ClassConstructor extends typeof DTO>(target: ClassConstructor): ObjectSchema {
    return GetObjectSchemaByPrototype(ObjectPrototype(target))
}

/**
 * Set object's validate options
 * @param target
 * @param options
 * @constructor
 */
export function SetObjectValidateOptions<ClassConstructor extends typeof DTO>(target: ClassConstructor, options: ValidationOptions): ClassConstructor {
    let _opts: ValidationOptions = DefaultValidationOptions
    if (Reflect.hasOwnMetadata(DTO_VALIDATE_OPTIONS, target)) _opts = Reflect.getOwnMetadata(DTO_VALIDATE_OPTIONS, target)
    _opts = Object.assign(_opts, options)
    Reflect.defineMetadata(DTO_VALIDATE_OPTIONS, _opts, target)
    return target
}

/**
 * Get object's validate options
 * @param target
 * @constructor
 */
export function GetObjectValidateOptions<ClassPrototype extends DTO>(target: ClassPrototype): ValidationOptions {
    let _opts: ValidationOptions
    if (Reflect.hasOwnMetadata(DTO_VALIDATE_OPTIONS, ObjectConstructor(target)))
        _opts = Reflect.getOwnMetadata(DTO_VALIDATE_OPTIONS, ObjectConstructor(target))
    else
        _opts = DefaultValidationOptions
    return _opts
}