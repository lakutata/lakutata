import {Controller} from '../lib/base/Controller.js'
import {CONTROLLER_ACTION_MAP} from '../constants/MetadataKey.js'
import {IConstructor} from '../interfaces/IConstructor.js'
import {As} from '../Utilities.js'

type TFunction = (...args: any[]) => any | Promise<any>

/**
 * 控制器动作方法声明
 * @constructor
 */
export function Action<T extends Controller>(pattern: Record<string, any>): (target: T, propertyKey: keyof T, descriptor: TypedPropertyDescriptor<TFunction>) => void {
    return function <T extends Controller>(target: T, propertyKey: keyof T, descriptor: TypedPropertyDescriptor<TFunction>): void {
        if (!pattern || !Object.keys(pattern).length) throw new Error('The pattern of the action cannot be empty')
        const controllerConstructor: IConstructor<T> = As<IConstructor<T>>(target.constructor)
        if (!Reflect.getOwnMetadata(CONTROLLER_ACTION_MAP, controllerConstructor)) Reflect.defineMetadata(CONTROLLER_ACTION_MAP, new Map(), controllerConstructor)
        //todo
        // As<Map<any,any>>(Reflect.getOwnMetadata(CONTROLLER_ACTION_MAP,controllerConstructor))
    }
}
