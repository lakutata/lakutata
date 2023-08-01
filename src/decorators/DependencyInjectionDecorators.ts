import {BaseObject} from '../lib/base/BaseObject.js'
import {IConstructor} from '../interfaces/IConstructor.js'
import {As} from '../Utilities.js'
import {DI_TARGET_CONSTRUCTOR_INJECTS} from '../constants/MetadataKey.js'

type InjectMappingObject = {
    injectKey: string
    propertyKey: string
}

/**
 * 使用所修饰的属性名作为注入项的名称
 * @constructor
 */
export function Inject<T extends BaseObject>(): (target: T, propertyKey: string) => void
/**
 * 使用指定的注入项名称
 * @param name
 * @constructor
 */
export function Inject<T extends BaseObject>(name: string): (target: T, propertyKey: string) => void
export function Inject<T extends BaseObject>(name?: string): (target: T, propertyKey: string) => void {
    return function <T extends BaseObject>(target: T, propertyKey: string): void {
        const targetConstructor: IConstructor<T> = As<IConstructor<T>>(target.constructor)
        if (!Reflect.hasMetadata(DI_TARGET_CONSTRUCTOR_INJECTS, targetConstructor)) Reflect.defineMetadata(DI_TARGET_CONSTRUCTOR_INJECTS, new Map<string, string>(), targetConstructor)
        const injectMappingObject: InjectMappingObject = {
            injectKey: propertyKey,
            propertyKey: propertyKey
        }
        if (name) injectMappingObject.injectKey = name
        As<Map<string, string>>(Reflect.getMetadata(DI_TARGET_CONSTRUCTOR_INJECTS, targetConstructor)).set(injectMappingObject.propertyKey, injectMappingObject.injectKey)
    }
}
