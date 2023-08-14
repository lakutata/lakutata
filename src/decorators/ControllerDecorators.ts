import {Controller} from '../lib/base/Controller.js'
import {CONTROLLER_ACTION_MAP} from '../constants/MetadataKey.js'
import {IConstructor} from '../interfaces/IConstructor.js'
import {As, SortObject} from '../Utilities.js'
import {SHA1} from '../Hash.js'
import {ControllerActionMapItem} from '../types/ControllerActionMapItem.js'

type TActionFunction = (inp?: any) => Promise<any>

type TExcludes<T, U> = T extends U ? never : T

type TActionName<T, U> = TExcludes<keyof T, U>

/**
 * 控制器动作方法声明
 * @constructor
 */
export function Action<T extends Controller>(pattern: Record<string, any>): (target: T, propertyKey: TActionName<T, keyof Controller>, descriptor: TypedPropertyDescriptor<TActionFunction>) => TypedPropertyDescriptor<TActionFunction> {
    return function <T extends Controller>(target: T, propertyKey: keyof T, descriptor: TypedPropertyDescriptor<TActionFunction>): TypedPropertyDescriptor<TActionFunction> {
        if (!pattern || !Object.keys(pattern).length) throw new Error('The pattern of the action cannot be empty')
        const controllerConstructor: IConstructor<T> = As<IConstructor<T>>(target.constructor)
        if (!Reflect.getOwnMetadata(CONTROLLER_ACTION_MAP, controllerConstructor)) Reflect.defineMetadata(CONTROLLER_ACTION_MAP, new Map<string, ControllerActionMapItem>(), controllerConstructor)
        pattern = SortObject(pattern, {deep: true, order: 'asc'})
        const patternHash: string = SHA1(JSON.stringify(pattern))
        const actionId: string = `${controllerConstructor.name}/${propertyKey.toString()}/${patternHash}`
        As<Map<string, ControllerActionMapItem>>(Reflect.getOwnMetadata(CONTROLLER_ACTION_MAP, controllerConstructor)).set(actionId, {
            pattern: pattern,
            patternHash: patternHash,
            class: controllerConstructor,
            method: propertyKey
        })
        const originalMethod: TActionFunction = descriptor.value as any
        descriptor.value = async function (this: Controller, inp: any, ...args: any[]): Promise<any> {
            const allowAction: boolean = await this.beforeAction(inp, propertyKey)
            if (!allowAction) return
            const actionResult: any = await originalMethod.apply(this, As<any>([inp, ...args]))
            return await this.afterAction(inp, propertyKey, actionResult)
        }
        return descriptor
    }
}
