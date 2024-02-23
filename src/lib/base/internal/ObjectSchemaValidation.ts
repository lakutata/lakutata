import {DTO} from '../../core/DTO.js'
import {Schema} from 'joi'
import {ObjectConstructor} from '../func/ObjectConstructor.js'
import {DTO_PROPERTY_SCHEMAS} from '../../../constants/metadata-keys/DTOMetadataKey.js'
import {ObjectParentConstructors} from '../func/ObjectParentConstructors.js'
import {ObjectPrototype} from '../func/ObjectPrototype.js'

export type ObjectPropertySchemaMap = Map<string, Schema>

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
