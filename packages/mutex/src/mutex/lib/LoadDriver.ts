import {MutexDriverNotFoundException} from '../exceptions/MutexDriverNotFoundException.js'

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
    try {
        const driver: any = await import(packageName)
        return (driver[member] === undefined && driver.default ? driver.default : driver) as T
    } catch (e) {
        if (!isPackageMissing(e, packageName)) throw e
    }
    throw new MutexDriverNotFoundException('Package "{packageName}" is required for this driver of the locks. Run "npm install {packageName}".', {packageName: packageName})
}
