import {isPackaged} from '@lakutata/core'
import {ClusterTransportNotFoundException} from '../../exceptions/ClusterTransportNotFoundException.js'

/**
 * The client packages of the transports (optional dependencies), imported by their names written out: the bundlers
 * follow them (a name given at run time is not bundled, the bundle has no node_modules to load it from)
 */
const CLIENTS: Record<string, () => Promise<any>> = {
    'ioredis': () => import('ioredis'),
    'nats': () => import('nats')
}

/**
 * Whether an error reports the package itself as missing
 * @param error The error of the import.
 * @param packageName The package imported.
 */
function isPackageMissing(error: unknown, packageName: string): boolean {
    const {code, message} = error as {code?: string, message?: string}
    if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') return false
    return !!message && (message.includes(`'${packageName}'`) || message.includes(`"${packageName}"`))
}

/**
 * Load the client package of a transport (an optional dependency)
 * @param member A member of its API, to find it in the ESM namespace or the CommonJS exports.
 * @param packageName The package.
 */
export async function loadClient<T = any>(member: string, packageName: string): Promise<T> {
    let missing: unknown
    try {
        const client: any = await CLIENTS[packageName]()
        return (client[member] === undefined && client.default ? client.default : client) as T
    } catch (e) {
        if (!isPackageMissing(e, packageName)) throw e
        missing = e
    }
    //A bundled application has the packages installed when it was bundled
    const exception: ClusterTransportNotFoundException = isPackaged() ?
        new ClusterTransportNotFoundException('Package "{packageName}" is required for this transport of the cluster, and was not installed when the application was bundled: install it in the project, then bundle the application again.', {packageName: packageName}) :
        new ClusterTransportNotFoundException('Package "{packageName}" is required for this transport of the cluster. Run "npm install {packageName}".', {packageName: packageName})
    exception.cause = missing
    throw exception
}
