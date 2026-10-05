import {DTO} from './DTO.js'
import {
    DTO_CONSTRUCTOR,
    DTO_INDEX_SIGNATURE_SCHEMA,
    DTO_OBJECT_REFINEMENT,
    DTO_PROPERTY_SCHEMAS
} from '../../constants/DTOMetadataKey.js'
import {DataValidator} from './DataValidator.js'
import {Schema} from '../validation/types/Schema.js'
import {ObjectSchema} from '../validation/interfaces/ObjectSchema.js'
import {SchemaMap} from '../validation/types/SchemaMap.js'
import {objectConstructor} from '@lakutata/utils/ObjectConstructor'
import {objectParentConstructors} from '@lakutata/utils/ObjectParentConstructors'
import {objectPrototype} from '@lakutata/utils/ObjectPrototype'
import {isSymbol} from '@lakutata/utils/IsSymbol'
import {As} from '@lakutata/utils/As'
import {type CachedSchema} from './CachedSchema.js'

export type ObjectPropertySchemaMap = Map<string, Schema>

/**
 * Adds the class-level constraints of a DTO to the object schema of its properties
 */
export type ObjectSchemaRefinement = (schema: ObjectSchema) => ObjectSchema

/**
 * Revision of all DTO schema definitions, bumped whenever a schema definition changes
 */
let schemaRevision: number = 0

/**
 * Invalidate every cached DTO schema
 * @constructor
 */
export function invalidateDTOSchemas(): void {
    schemaRevision++
}

/**
 * Get a value cached per DTO class, built again after any schema definition change
 * @param cache
 * @param target
 * @param build
 * @constructor
 */
export function getCachedDTOSchema<T>(cache: WeakMap<Function, CachedSchema<T>>, target: Function, build: () => T): T {
    const cached: CachedSchema<T> | undefined = cache.get(target)
    if (cached && cached.revision === schemaRevision) return cached.value
    const value: T = build()
    cache.set(target, {revision: schemaRevision, value: value})
    return value
}

const objectSchemaCache: WeakMap<Function, CachedSchema<ObjectSchema>> = new WeakMap()

/**
 * Define DTO
 * @param target
 * @constructor
 */
export function defineObjectAsDTO<ClassConstructor extends typeof DTO>(target: ClassConstructor): ClassConstructor {
    Reflect.defineMetadata(DTO_CONSTRUCTOR, true, target)
    invalidateDTOSchemas()
    return target
}

/**
 * Check the target constructor is DTO constructor or not
 * @param target
 * @constructor
 */
export function isDTO<ClassConstructor extends typeof DTO>(target: ClassConstructor): boolean {
    return !!Reflect.getMetadata(DTO_CONSTRUCTOR, target)
}

/**
 * Set object index signature schema
 * @param target
 * @param schema
 * @constructor
 */
export function setObjectIndexSignatureSchema<ClassConstructor extends typeof DTO>(target: ClassConstructor, schema: Schema): ClassConstructor {
    Reflect.defineMetadata(DTO_INDEX_SIGNATURE_SCHEMA, schema, target)
    invalidateDTOSchemas()
    return target
}

/**
 * Get object's index signature schema by its prototype
 * @param target
 * @constructor
 */
export function getObjectIndexSignatureSchemaByPrototype<ClassPrototype extends DTO>(target: ClassPrototype): Schema | null {
    if (Reflect.hasOwnMetadata(DTO_INDEX_SIGNATURE_SCHEMA, objectConstructor(target))) return Reflect.getOwnMetadata(DTO_INDEX_SIGNATURE_SCHEMA, objectConstructor(target))
    for (const parentConstructor of objectParentConstructors(objectConstructor(target))) {
        if (Reflect.hasOwnMetadata(DTO_INDEX_SIGNATURE_SCHEMA, parentConstructor)) return Reflect.getOwnMetadata(DTO_INDEX_SIGNATURE_SCHEMA, parentConstructor)
    }
    return null
}

/**
 * Get object's index signature schema by its constructor
 * @param target
 * @constructor
 */
export function getObjectIndexSignatureSchemaByConstructor<ClassConstructor extends typeof DTO>(target: ClassConstructor): Schema | null {
    return getObjectIndexSignatureSchemaByPrototype(objectPrototype(target))
}

/**
 * Set data validation schema to object's property
 * @param target
 * @param propertyKey
 * @param schema
 * @constructor
 */
export function setObjectPropertySchema<ClassPrototype extends DTO>(target: ClassPrototype, propertyKey: string | symbol, schema: Schema): void {
    if (isSymbol(propertyKey)) return
    //Only for DTO class
    if (!isDTO(As(objectConstructor(target)))) return
    propertyKey = As<string>(propertyKey)
    let objectPropertySchemaMap: ObjectPropertySchemaMap
    if (Reflect.hasOwnMetadata(DTO_PROPERTY_SCHEMAS, objectConstructor(target))) {
        objectPropertySchemaMap = Reflect.getOwnMetadata(DTO_PROPERTY_SCHEMAS, objectConstructor(target))
    } else {
        objectPropertySchemaMap = new Map()
        const parentObjectPropertySchemaMaps: (typeof objectPropertySchemaMap)[] = []
        objectParentConstructors(objectConstructor(target)).forEach((parentConstructor: Function): void => {
            if (Reflect.hasOwnMetadata(DTO_PROPERTY_SCHEMAS, parentConstructor))
                parentObjectPropertySchemaMaps.unshift(Reflect.getOwnMetadata(DTO_PROPERTY_SCHEMAS, parentConstructor))
        })
        parentObjectPropertySchemaMaps.forEach((parentObjectInjectionMap: typeof objectPropertySchemaMap): void =>
            parentObjectInjectionMap.forEach((value: Schema, key: typeof propertyKey) => objectPropertySchemaMap.set(As<string>(key), value)))
    }
    objectPropertySchemaMap.set(propertyKey, schema)
    Reflect.defineMetadata(DTO_PROPERTY_SCHEMAS, objectPropertySchemaMap, objectConstructor(target))
    invalidateDTOSchemas()
}

/**
 * Get object's property schemas by its prototype
 * @param target
 * @constructor
 */
export function getObjectPropertySchemas<ClassPrototype extends DTO>(target: ClassPrototype): ObjectPropertySchemaMap {
    const objectPropertySchemaMap: ObjectPropertySchemaMap = new Map()
    const parentObjectPropertySchemaMaps: (typeof objectPropertySchemaMap)[] = []
    objectParentConstructors(objectConstructor(target)).forEach((parentConstructor: Function): void => {
        if (Reflect.hasOwnMetadata(DTO_PROPERTY_SCHEMAS, parentConstructor))
            parentObjectPropertySchemaMaps.unshift(Reflect.getOwnMetadata(DTO_PROPERTY_SCHEMAS, parentConstructor))
    })
    parentObjectPropertySchemaMaps.forEach((parentObjectInjectionMap: typeof objectPropertySchemaMap): void =>
        parentObjectInjectionMap.forEach((value: Schema, key: string) => objectPropertySchemaMap.set(As<string>(key), value)))
    As<ObjectPropertySchemaMap | undefined>(Reflect.getOwnMetadata(DTO_PROPERTY_SCHEMAS, objectConstructor(target)))?.forEach((value: Schema, key: string) => objectPropertySchemaMap.set(As<string>(key), value))
    return objectPropertySchemaMap
}

/**
 * Get DTO object schema by its prototype
 * @param target
 * @constructor
 */
export function getObjectSchemaByPrototype<ClassPrototype extends DTO>(target: ClassPrototype): ObjectSchema {
    //Schemas are immutable, so the schema built for a class is shared until a schema definition changes
    return getCachedDTOSchema(objectSchemaCache, objectConstructor(target), (): ObjectSchema => {
        const schemaMap: SchemaMap = {}
        getObjectPropertySchemas(target).forEach((propertySchema: Schema, propertyKey: string): void => {
            schemaMap[propertyKey] = propertySchema
        })
        const refinement: ObjectSchemaRefinement | undefined = Reflect.getMetadata(DTO_OBJECT_REFINEMENT, objectConstructor(target))
        return refinement ? refinement(DataValidator.Object(schemaMap)) : DataValidator.Object(schemaMap)
    })
}

/**
 * Get DTO object schema by its constructor
 * @param target
 * @constructor
 */
export function getObjectSchemaByConstructor<ClassConstructor extends typeof DTO>(target: ClassConstructor): ObjectSchema {
    return getObjectSchemaByPrototype(objectPrototype(target))
}

/**
 * Set the class-level constraints of a DTO (applied to the object schema of its properties, inherited by its subclasses)
 * @param target
 * @param refinement
 * @constructor
 */
export function setObjectSchemaRefinement<ClassConstructor extends typeof DTO>(target: ClassConstructor, refinement: ObjectSchemaRefinement): ClassConstructor {
    Reflect.defineMetadata(DTO_OBJECT_REFINEMENT, refinement, target)
    invalidateDTOSchemas()
    return target
}
