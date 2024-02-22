import {BaseObject} from '../BaseObject.js'
import {ObjectConstructor} from '../func/ObjectConstructor.js'
import {getMetadata, getOwnMetadata, hasOwnMetadata} from 'reflect-metadata/no-conflict'
import {DI_TARGET_CONSTRUCTOR_INJECTS} from '../../../constants/metadata-keys/DIMetadataKey.js'
import {ObjectParentConstructors} from '../func/ObjectParentConstructors.js'

/**
 * Set object inject item
 * @param target
 * @param propertyKey
 * @param name
 * @constructor
 */
export function SetObjectInject<ClassPrototype extends BaseObject>(target: ClassPrototype, propertyKey: string | symbol, name: string | symbol): void {
    let objectInjectionMap: Map<string | symbol, any>
    if (hasOwnMetadata(DI_TARGET_CONSTRUCTOR_INJECTS, ObjectConstructor(target))) {
        objectInjectionMap = getOwnMetadata(DI_TARGET_CONSTRUCTOR_INJECTS, ObjectConstructor(target))
    } else {
        objectInjectionMap = new Map()
        const parentObjectInjectionMaps: (typeof objectInjectionMap)[] = []
        ObjectParentConstructors(ObjectConstructor(target)).forEach((parentConstructor: Function): void => {
            if (hasOwnMetadata(DI_TARGET_CONSTRUCTOR_INJECTS, parentConstructor))
                parentObjectInjectionMaps.unshift(getOwnMetadata(DI_TARGET_CONSTRUCTOR_INJECTS, parentConstructor))
        })
        parentObjectInjectionMaps.forEach((parentObjectInjectionMap: typeof objectInjectionMap): void =>
            parentObjectInjectionMap.forEach((value, key: typeof propertyKey) => objectInjectionMap.set(key, value)))
    }
    const propertyDesignTypeConstructor: Function = getMetadata('design:type', target, propertyKey)
    //todo
    console.log(propertyDesignTypeConstructor)

}
