import koffi from 'koffi'
import {IRegisteredCallback} from './interfaces/IRegisteredCallback.js'
import {TypeSpec} from './types/TypeSpec.js'

/**
 * Register js callback
 * @see https://koffi.dev/callbacks#callback-types
 * @param callback
 * @param type
 * @constructor
 */
export function RegisterCallback(callback: Function, type: TypeSpec): IRegisteredCallback
/**
 * Register js callback
 * @see https://koffi.dev/callbacks#callback-types
 * @param thisValue
 * @param callback
 * @param type
 * @constructor
 */
export function RegisterCallback(thisValue: any, callback: Function, type: TypeSpec): IRegisteredCallback
export function RegisterCallback(a: any, b: any, c?: any): IRegisteredCallback {
    return koffi.register(a, b, c)
}
