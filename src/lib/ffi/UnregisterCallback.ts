import * as koffi from './lib/index.js'
import {IRegisteredCallback} from './interfaces/IRegisteredCallback.js'

/**
 * Unregister js callback
 * @see https://koffi.dev/callbacks#callback-types
 * @param callback
 * @constructor
 */
export function UnregisterCallback(callback: IRegisteredCallback): void {
    return koffi.unregister(callback)
}
