import {BaseObject} from '../lib/base/BaseObject.js'
import {IConstructor} from '../interfaces/IConstructor.js'
import {As} from '../Utilities.js'
import {
    DI_CONTAINER_SPECIAL_INJECT_APP_GETTER,
    DI_CONTAINER_SPECIAL_INJECT_MODULE_GETTER,
    DI_TARGET_CONSTRUCTOR_CONFIGURABLE_ITEMS,
    DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OPTIONS,
    DI_TARGET_CONSTRUCTOR_INJECTS, DI_TARGET_CONSTRUCTOR_SPECIAL_INJECTS
} from '../constants/MetadataKey.js'
import {Container} from '../lib/base/Container.js'
import {Schema, ValidationOptions} from '../Validator.js'
import {DTO} from '../lib/base/DTO.js'

type InjectMappingObject = {
    injectKey: string
    propertyKey: string
}

export type ConfigurableOptions = {
    onSet?: (value: any) => void
    onGet?: (value: any) => void
    accept?: Schema | IConstructor<DTO>
    acceptOptions?: ValidationOptions
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
/**
 * 使用注入项的构造函数
 * @param constructor
 * @constructor
 */
export function Inject<T extends BaseObject, U extends BaseObject>(constructor: IConstructor<U>): (target: T, propertyKey: string) => void
export function Inject<T extends BaseObject>(inp?: string | IConstructor<T>): (target: T, propertyKey: string) => void {
    return function <T extends BaseObject>(target: T, propertyKey: string): void {
        const targetConstructor: IConstructor<T> = As<IConstructor<T>>(target.constructor)
        if (!Reflect.hasMetadata(DI_TARGET_CONSTRUCTOR_INJECTS, targetConstructor)) Reflect.defineMetadata(DI_TARGET_CONSTRUCTOR_INJECTS, new Map<string, string>(), targetConstructor)
        const injectMappingObject: InjectMappingObject = {
            injectKey: propertyKey,
            propertyKey: propertyKey
        }
        if (inp) {
            if (typeof inp === 'string') {
                injectMappingObject.injectKey = inp
            } else {
                injectMappingObject.injectKey = Container.stringifyConstructor(inp)
            }
        }
        As<Map<string, string>>(Reflect.getMetadata(DI_TARGET_CONSTRUCTOR_INJECTS, targetConstructor)).set(injectMappingObject.propertyKey, injectMappingObject.injectKey)
    }
}

/**
 * 特殊类型数据注入
 * @param target
 * @param propertyKey
 * @param injectKey
 */
function specialInject<T extends BaseObject>(target: T, propertyKey: string, specialInjectKey: Symbol): void {
    const targetConstructor: IConstructor<T> = As<IConstructor<T>>(target.constructor)
    if (!Reflect.hasMetadata(DI_TARGET_CONSTRUCTOR_SPECIAL_INJECTS, targetConstructor)) Reflect.defineMetadata(DI_TARGET_CONSTRUCTOR_SPECIAL_INJECTS, new Map<string, Symbol>(), targetConstructor)
    As<Map<string, Symbol>>(Reflect.getMetadata(DI_TARGET_CONSTRUCTOR_SPECIAL_INJECTS, targetConstructor)).set(propertyKey, specialInjectKey)

}

/**
 * 将应用程序对象注入所修饰的属性
 * @constructor
 */
export function InjectApp() {
    return function <T extends BaseObject>(target: T, propertyKey: string): void {
        return specialInject(target, propertyKey, DI_CONTAINER_SPECIAL_INJECT_APP_GETTER)
    }
}

/**
 * 将当前类所属的模块对象注入所修饰的属性
 * @constructor
 */
export function InjectModule() {
    return function <T extends BaseObject>(target: T, propertyKey: string): void {
        return specialInject(target, propertyKey, DI_CONTAINER_SPECIAL_INJECT_MODULE_GETTER)
    }
}

/**
 * 可配置参数项
 * @constructor
 */
export function Configurable<T extends BaseObject>(options?: ConfigurableOptions): (target: T, propertyKey: string) => void {
    return function <T extends BaseObject>(target: T, propertyKey: string): void {
        const targetConstructor: IConstructor<T> = As<IConstructor<T>>(target.constructor)
        if (!Reflect.hasOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OPTIONS, targetConstructor)) Reflect.defineMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OPTIONS, new Map<string, ConfigurableOptions>(), targetConstructor)
        if (options) As<Map<string, ConfigurableOptions>>(Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OPTIONS, targetConstructor)).set(propertyKey, options)
        if (!Reflect.hasOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_ITEMS, targetConstructor)) Reflect.defineMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_ITEMS, new Set<string>(), targetConstructor)
        As<Set<string>>(Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_ITEMS, targetConstructor)).add(propertyKey)
    }
}
