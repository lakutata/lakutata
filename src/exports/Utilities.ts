import 'reflect-metadata'
import {setTimeout} from 'timers/promises'

/**
 * 异步等待
 * @param ms
 * @constructor
 */
export async function Delay(ms: number = 1000): Promise<void> {
    return await setTimeout(ms)
}

/**
 * 传递进来的参数不会有任何作用
 * @constructor
 */
export function DevNull(...args: any[]): void {
    return ThrowIntoBlackHole(...args)
}

/**
 * 传递进来的参数不会有任何作用
 * @constructor
 */
export function ThrowIntoBlackHole(...args: any[]): void {
    /**
     * 仅接受参数，但不对参数做任何处理
     */
}

/**
 * 配置对象属性
 * @param target
 * @param properties
 * @constructor
 */
export function ConfigureObjectProperties<T extends object = object>(target: T, properties: Record<string, any>): void {
    Object.keys(properties ? properties : {}).forEach((propertyKey: string) => target[propertyKey] = properties![propertyKey])
}

/**
 * 类型转换
 * @param inp
 * @constructor
 */
export function As<T = any>(inp: any): T {
    return inp as T
}






