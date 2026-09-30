import {CacheDriverNotFoundException} from '../exceptions/CacheDriverNotFoundException.js'

/**
 * Whether an error reports the package itself as missing
 * @param error
 * @param packageName
 */
function IsPackageMissing(error: unknown, packageName: string): boolean {
    const {code, message} = error as { code?: string, message?: string }
    if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') return false
    return !!message && (message.includes(`'${packageName}'`) || message.includes(`"${packageName}"`))
}

/**
 * Load the driver package of a store, the first installed of the candidates
 * @param member a member of the driver API, to find it in the ESM namespace or the CommonJS exports
 * @param packageNames
 */
export async function LoadDriver<T = any>(member: string, ...packageNames: string[]): Promise<T> {
    for (const packageName of packageNames) {
        try {
            const driver: any = await import(packageName)
            return (driver[member] === undefined && driver.default ? driver.default : driver) as T
        } catch (e) {
            if (!IsPackageMissing(e, packageName)) throw e
        }
    }
    throw new CacheDriverNotFoundException('Package "{packageName}" is required for this driver. Run "npm install {packageName}".', {packageName: packageNames[0]})
}
