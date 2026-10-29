import {getSystemErrorName} from 'node:util'
import {addon} from './Addon.js'
import {NetIfException} from '../exceptions/NetIfException.js'

/**
 * An address of an interface as the addon reads it: `tentative` while an IPv6 address is in its duplicate address
 * detection (not usable yet)
 */
export interface NativeAddress {
    address: string
    family: 'IPv4' | 'IPv6'
    prefixLength: number
    tentative: boolean
    scopeid?: number
}

/**
 * An interface as the addon reads it
 */
export interface NativeInterface {
    name: string
    index: number
    mac?: string
    up: boolean
    running: boolean
    loopback: boolean
    addresses: NativeAddress[]
}

/**
 * The functions of the addon
 */
interface Addon {
    list(): NativeInterface[]

    watch(changed: () => void): void

    unwatch(): void
}

/**
 * The error of a call of the addon as an exception of the package: the code of the error of the system as its `errno`
 * (the name of the POSIX error, the number of the Windows one)
 */
function exception(error: unknown): NetIfException {
    if (!(error instanceof Error)) return new NetIfException(String(error))
    const thrown: NetIfException = new NetIfException(error.message, {cause: error})
    const number: unknown = (error as Error & {errno?: unknown}).errno
    if (typeof number === 'number') {
        if (process.platform === 'win32') {
            thrown.errno = number
        } else {
            try {
                thrown.errno = getSystemErrorName(-number)
            } catch {
                thrown.errno = number
            }
        }
    }
    return thrown
}

/**
 * Calls a function of the addon, its errors turned into exceptions of the package
 */
function call<Result>(run: (functions: Addon) => Result): Result {
    try {
        return run(addon as Addon)
    } catch (error) {
        throw exception(error)
    }
}

/**
 * The interfaces of the machine as the addon reads them
 */
export function nativeList(): NativeInterface[] {
    return call((functions: Addon): NativeInterface[] => functions.list())
}

/**
 * Starts the notifications of the changes of the interfaces: changed() called at each one (once by thread)
 */
export function nativeWatch(changed: () => void): void {
    call((functions: Addon): void => functions.watch(changed))
}

/**
 * Stops the notifications
 */
export function nativeUnwatch(): void {
    call((functions: Addon): void => functions.unwatch())
}
