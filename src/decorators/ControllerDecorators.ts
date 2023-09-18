import 'reflect-metadata'
import {Controller} from '../lib/base/Controller'
import {
    CONTROLLER_ACTION_MAP,
    CONTROLLER_AUTH_MAP,
    CONTROLLER_PATTERN_MANAGER
} from '../constants/MetadataKey'
import {IConstructor} from '../interfaces/IConstructor'
import {As, SortObject} from '../Helper'
import {ControllerActionMapItem} from '../types/ControllerActionMapItem'
import {Patrun} from 'patrun'
import {IPatRun} from '../interfaces/IPatRun'
import {ActionPattern} from '../types/ActionPattern'
import {ActionAuthOptions} from '../types/ActionAuthOptions'
import {ControllerAuthConfigItem} from '../types/ControllerAuthConfigItem'
import {defaultDomain} from '../constants/DefaultValue'
import {AccessDenyException} from '../exceptions/auth/AccessDenyException'
import {Application} from '../lib/Application'
import {SHA1} from '../Hash'

type TActionFunction = (inp?: any) => Promise<any>

type TExcludes<T, U> = T extends U ? never : T

type TActionName<T, U> = TExcludes<keyof T, U>

export type ControllerActionDecorator<T extends Controller> = (target: T, propertyKey: TActionName<T, keyof Controller | 'init' | '__init' | 'destroy' | '__destroy'>, descriptor: TypedPropertyDescriptor<TActionFunction>) => TypedPropertyDescriptor<TActionFunction>

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
    if (!Reflect.hasOwnMetadata(CONTROLLER_AUTH_MAP, Application)) Reflect.defineMetadata(CONTROLLER_AUTH_MAP, new Map<IConstructor<T>, Map<string, ControllerAuthConfigItem>>(), Application)
    const action: string = authOptions.name ? authOptions.name : `${controllerConstructor.name}.${propertyKey.toString()}`
    const operation: string = authOptions.operation
    if (!As<Map<IConstructor<T>, Map<string, ControllerAuthConfigItem>>>(Reflect.getOwnMetadata(CONTROLLER_AUTH_MAP, Application)).has(controllerConstructor))
        As<Map<IConstructor<T>, Map<string, ControllerAuthConfigItem>>>(Reflect.getOwnMetadata(CONTROLLER_AUTH_MAP, Application)).set(controllerConstructor, new Map())
    As<Map<IConstructor<T>, Map<string, ControllerAuthConfigItem>>>(Reflect.getOwnMetadata(CONTROLLER_AUTH_MAP, Application)).get(controllerConstructor)?.set(propertyKey.toString(), {
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
export function Action<T extends Controller>(pattern: ActionPattern, authOptions?: ActionAuthOptions): ControllerActionDecorator<T> {
    return function <T extends Controller>(target: T, propertyKey: keyof T, descriptor: TypedPropertyDescriptor<TActionFunction>): TypedPropertyDescriptor<TActionFunction> {
        if (!pattern || !Object.keys(pattern).length) throw new Error('The pattern of the action cannot be empty')
        const controllerConstructor: IConstructor<T> = As<IConstructor<T>>(target.constructor)
        registerActionToControllerActionMap<T>(pattern, controllerConstructor, propertyKey)
        if (authOptions) registerActionToAuthMap(authOptions, controllerConstructor, propertyKey)
        const originalMethod: TActionFunction = descriptor.value as any
        descriptor.value = async function (this: Controller, inp: any, ...args: any[]): Promise<any> {
            //鉴权
            if (this.access?.configured && authOptions) {
                const authRule: ControllerAuthConfigItem | undefined = As<Map<IConstructor<T>, Map<string, ControllerAuthConfigItem>> | undefined>(Reflect.getOwnMetadata(CONTROLLER_AUTH_MAP, Application))?.get(this.constructor as IConstructor<T>)?.get(propertyKey.toString())
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
