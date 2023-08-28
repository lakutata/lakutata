import 'reflect-metadata'
import {Controller} from '../lib/base/Controller'
import {CONTROLLER_ACTION_MAP, CONTROLLER_AUTH_MAP, CONTROLLER_PATTERN_MANAGER} from '../constants/MetadataKey'
import {IConstructor} from '../interfaces/IConstructor'
import {As, SortObject} from '../exports/Utilities'
import {SHA1} from '../exports/Hash'
import {ControllerActionMapItem} from '../types/ControllerActionMapItem'
import {Patrun} from 'patrun'
import {IPatRun} from '../interfaces/IPatRun'
import {ActionPattern} from '../types/ActionPattern'
import {ActionAuthOptions} from '../types/ActionAuthOptions'
import {ControllerAuthMapItem} from '../types/ControllerAuthMapItem'
import {defaultDomain} from '../constants/DefaultValue'
import {AccessDenyException} from '../exceptions/auth/AccessDenyException'

type TActionFunction = (inp?: any) => Promise<any>

type TExcludes<T, U> = T extends U ? never : T

type TActionName<T, U> = TExcludes<keyof T, U>

/**
 * 将Action添加至控制器的ActionMap中
 * @param pattern
 * @param controllerConstructor
 * @param propertyKey
 */
function registerActionToControllerActionMap<T extends Controller>(pattern: ActionPattern, controllerConstructor: IConstructor<T>, propertyKey: keyof T): void {
    if (!Reflect.hasOwnMetadata(CONTROLLER_ACTION_MAP, controllerConstructor)) Reflect.defineMetadata(CONTROLLER_ACTION_MAP, new Map<string, ControllerActionMapItem>(), controllerConstructor)
    if (!Reflect.hasOwnMetadata(CONTROLLER_PATTERN_MANAGER, controllerConstructor)) Reflect.defineMetadata(CONTROLLER_PATTERN_MANAGER, Patrun({gex: true}), controllerConstructor)
    pattern = SortObject(pattern, {deep: true, order: 'asc'})
    const patternHash: string = SHA1(JSON.stringify(pattern))
    if (!As<Map<string, ControllerActionMapItem>>(Reflect.getOwnMetadata(CONTROLLER_ACTION_MAP, controllerConstructor)).has(patternHash)) {
        As<Map<string, ControllerActionMapItem>>(Reflect.getOwnMetadata(CONTROLLER_ACTION_MAP, controllerConstructor)).set(patternHash, {
            pattern: pattern,
            patternHash: patternHash,
            class: controllerConstructor,
            method: propertyKey
        })
        //Controller自身的PatternManager，仅记录Pattern与propertyKey的对应关系
        As<IPatRun>(Reflect.getOwnMetadata(CONTROLLER_PATTERN_MANAGER, controllerConstructor)).add(pattern, propertyKey)
    }
}

/**
 * 将Action添加至控制器的AuthMap中
 */
function registerActionToAuthMap<T extends Controller>(authOptions: ActionAuthOptions, controllerConstructor: IConstructor<T>, propertyKey: keyof T): void {
    if (!Reflect.hasOwnMetadata(CONTROLLER_AUTH_MAP, controllerConstructor)) Reflect.defineMetadata(CONTROLLER_AUTH_MAP, new Map<string, ControllerAuthMapItem>(), controllerConstructor)
    const action: string = authOptions.name ? authOptions.name : `${controllerConstructor.name}.${propertyKey.toString()}`
    const operation: string = authOptions.operation
    As<Map<string, ControllerAuthMapItem>>(Reflect.getOwnMetadata(CONTROLLER_AUTH_MAP, controllerConstructor)).set(propertyKey.toString(), {
        action: action,
        operation: operation,
        domain: authOptions.domain ? authOptions.domain : defaultDomain
    })
}

/**
 * 控制器动作方法声明
 * @param pattern
 * @param authOptions
 * @constructor
 */
export function Action<T extends Controller>(pattern: ActionPattern, authOptions?: ActionAuthOptions): (target: T, propertyKey: TActionName<T, keyof Controller | 'init' | '__init' | 'destroy' | '__destroy'>, descriptor: TypedPropertyDescriptor<TActionFunction>) => TypedPropertyDescriptor<TActionFunction> {
    return function <T extends Controller>(target: T, propertyKey: keyof T, descriptor: TypedPropertyDescriptor<TActionFunction>): TypedPropertyDescriptor<TActionFunction> {
        if (!pattern || !Object.keys(pattern).length) throw new Error('The pattern of the action cannot be empty')
        const controllerConstructor: IConstructor<T> = As<IConstructor<T>>(target.constructor)
        registerActionToControllerActionMap<T>(pattern, controllerConstructor, propertyKey)
        if (authOptions) registerActionToAuthMap(authOptions, controllerConstructor, propertyKey)
        const originalMethod: TActionFunction = descriptor.value as any
        descriptor.value = async function (this: Controller, inp: any, ...args: any[]): Promise<any> {
            //鉴权
            if (this.access?.configured && authOptions) {
                const authRule: ControllerAuthMapItem | undefined = As<Map<string, ControllerAuthMapItem> | undefined>(Reflect.getOwnMetadata(CONTROLLER_AUTH_MAP, this.constructor))?.get(propertyKey.toString())
                if (authRule) {
                    const allowAccess: boolean = await this.access.validate(authRule.action, typeof authRule.domain === 'string' ? authRule.domain : authRule.domain(inp), authRule.operation)
                    if (!allowAccess) throw new AccessDenyException('No permission to access this action.')
                }
            }
            const allowAction: boolean = await this.beforeAction(inp, <string>propertyKey)
            if (!allowAction) return
            const actionResult: any = await originalMethod.apply(this, As<any>([inp, ...args]))
            return await this.afterAction(inp, <string>propertyKey, actionResult)
        }
        return descriptor
    }
}
