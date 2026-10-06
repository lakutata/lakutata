import {isPackaged} from '@lakutata/core'
import {MutexDriverNotFoundException} from '../exceptions/MutexDriverNotFoundException.js'

/**
 * The client packages of the drivers (optional dependencies), imported by their names written out: the bundlers follow
 * them (a name given at run time is not bundled, the bundle has no node_modules to load it from)
 */
const DRIVERS: Record<string, () => Promise<any>> = {
    'redis': () => import('redis'),
    'pg': () => import('pg'),
    'mysql2/promise': () => import('mysql2/promise')
}

/**
 * Whether an error reports the package itself as missing
 * @param error
 * @param packageName
 */
function isPackageMissing(error: unknown, packageName: string): boolean {
    const {code, message} = error as { code?: string, message?: string }
    if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') return false
    return !!message && (message.includes(`'${packageName}'`) || message.includes(`"${packageName}"`))
}

/**
 * Load the client package of a driver (an optional dependency)
 * @param member a member of its API, to find it in the ESM namespace or the CommonJS exports
 * @param packageName
 */
export async function loadDriver<T = any>(member: string, packageName: string): Promise<T> {
    let missing: unknown
    try {
        const driver: any = await (DRIVERS[packageName] ?? ((): Promise<any> => import(packageName)))()
        return (driver[member] === undefined && driver.default ? driver.default : driver) as T
    } catch (e) {
        if (!isPackageMissing(e, packageName)) throw e
        missing = e
    }
    //A bundled application has the packages installed when it was bundled
    const exception: MutexDriverNotFoundException = isPackaged() ?
        new MutexDriverNotFoundException('Package "{packageName}" is required for this driver of the locks, and was not installed when the application was bundled: install it in the project, then bundle the application again.', {packageName: packageName}) :
        new MutexDriverNotFoundException('Package "{packageName}" is required for this driver of the locks. Run "npm install {packageName}".', {packageName: packageName})
    exception.cause = missing
    throw exception
}
