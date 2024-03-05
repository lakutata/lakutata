import {DTO} from '../../core/DTO.js'
import {ObjectConstructor} from '../func/ObjectConstructor.js'
import {
    DTO_CONSTRUCTOR,
    DTO_INDEX_SIGNATURE_SCHEMA,
    DTO_PROPERTY_SCHEMAS,
    DTO_VALIDATE_OPTIONS
} from '../../../constants/metadata-keys/DTOMetadataKey.js'
import {ObjectParentConstructors} from '../func/ObjectParentConstructors.js'
import {ObjectPrototype} from '../func/ObjectPrototype.js'
import {DataValidator} from './DataValidator.js'
import {IsSymbol} from '../func/IsSymbol.js'
import {As} from '../func/As.js'
import {Schema} from '../../validation/types/Schema.js'
import {ObjectSchema} from '../../validation/interfaces/ObjectSchema.js'
import {ValidationOptions} from '../../validation/interfaces/ValidationOptions.js'
import {DefaultValidationOptions} from '../../validation/VLD.js'
import {SchemaMap} from '../../validation/types/SchemaMap.js'

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
export function GetObjectIndexSignatureSchemaByPrototype<ClassPrototype extends DTO>(target: ClassPrototype): Schema | null {
    if (Reflect.hasOwnMetadata(DTO_INDEX_SIGNATURE_SCHEMA, ObjectConstructor(target))) return Reflect.getOwnMetadata(DTO_INDEX_SIGNATURE_SCHEMA, ObjectConstructor(target))
    for (const parentConstructor of ObjectParentConstructors(ObjectConstructor(target))) {
        if (Reflect.hasOwnMetadata(DTO_INDEX_SIGNATURE_SCHEMA, parentConstructor)) return Reflect.getOwnMetadata(DTO_INDEX_SIGNATURE_SCHEMA, parentConstructor)
    }
    return null
}

/**
 * Get object's index signature schema by its constructor
 * @param target
 * @constructor
 */
export function GetObjectIndexSignatureSchemaByConstructor<ClassConstructor extends typeof DTO>(target: ClassConstructor): Schema | null {
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
    if (IsSymbol(propertyKey)) return
    //Only for DTO class
    if (!IsDTO(As(ObjectConstructor(target)))) return
    propertyKey = As<string>(propertyKey)
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
            parentObjectInjectionMap.forEach((value: Schema, key: typeof propertyKey) => objectPropertySchemaMap.set(As<string>(key), value)))
    }
    objectPropertySchemaMap.set(propertyKey, schema)
    Reflect.defineMetadata(DTO_PROPERTY_SCHEMAS, objectPropertySchemaMap, ObjectConstructor(target))
}

/**
 * Get object's property schemas by its prototype
 * @param target
 * @constructor
 */
export function GetObjectPropertySchemas<ClassPrototype extends DTO>(target: ClassPrototype): ObjectPropertySchemaMap {
    const objectPropertySchemaMap: ObjectPropertySchemaMap = new Map()
    const parentObjectPropertySchemaMaps: (typeof objectPropertySchemaMap)[] = []
    ObjectParentConstructors(ObjectConstructor(target)).forEach((parentConstructor: Function): void => {
        if (Reflect.hasOwnMetadata(DTO_PROPERTY_SCHEMAS, parentConstructor))
            parentObjectPropertySchemaMaps.unshift(Reflect.getOwnMetadata(DTO_PROPERTY_SCHEMAS, parentConstructor))
    })
    parentObjectPropertySchemaMaps.forEach((parentObjectInjectionMap: typeof objectPropertySchemaMap): void =>
        parentObjectInjectionMap.forEach((value: Schema, key: string) => objectPropertySchemaMap.set(As<string>(key), value)))
    As<ObjectPropertySchemaMap | undefined>(Reflect.getOwnMetadata(DTO_PROPERTY_SCHEMAS, ObjectConstructor(target)))?.forEach((value: Schema, key: string) => objectPropertySchemaMap.set(As<string>(key), value))
    return objectPropertySchemaMap
}

/**
 * Get DTO object schema by its prototype
 * @param target
 * @constructor
 */
export function GetObjectSchemaByPrototype<ClassPrototype extends DTO>(target: ClassPrototype): ObjectSchema {
    const schemaMap: SchemaMap = {}
    GetObjectPropertySchemas(target).forEach((propertySchema: Schema, propertyKey: string): void => {
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
