import {isPackaged} from '@lakutata/core'
import {CacheDriverNotFoundException} from '../exceptions/CacheDriverNotFoundException.js'

/**
 * The driver packages of the stores (optional dependencies), imported by their names written out: the bundlers follow
 * them (a name given at run time is not bundled, the bundle has no node_modules to load it from)
 */
const DRIVERS: Record<string, () => Promise<any>> = {
    'pg': () => import('pg'),
    'redis': () => import('redis'),
    '@redis/client': () => import('@redis/client'),
    'mysql2': () => import('mysql2'),
    'sqlite3': () => import('sqlite3'),
    'mongodb': () => import('mongodb'),
    'memjs': () => import('memjs')
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
 * Load the driver package of a store, the first installed of the candidates
 * @param member a member of the driver API, to find it in the ESM namespace or the CommonJS exports
 * @param packageNames
 */
export async function loadDriver<T = any>(member: string, ...packageNames: string[]): Promise<T> {
    let missing: unknown
    for (const packageName of packageNames) {
        try {
            const driver: any = await (DRIVERS[packageName] ?? ((): Promise<any> => import(packageName)))()
            return (driver[member] === undefined && driver.default ? driver.default : driver) as T
        } catch (e) {
            if (!isPackageMissing(e, packageName)) throw e
            missing ??= e
        }
    }
    //A bundled application has the packages installed when it was bundled
    const exception: CacheDriverNotFoundException = isPackaged() ?
        new CacheDriverNotFoundException('Package "{packageName}" is required for this driver, and was not installed when the application was bundled: install it in the project, then bundle the application again.', {packageName: packageNames[0]}) :
        new CacheDriverNotFoundException('Package "{packageName}" is required for this driver. Run "npm install {packageName}".', {packageName: packageNames[0]})
    exception.cause = missing
    throw exception
}
