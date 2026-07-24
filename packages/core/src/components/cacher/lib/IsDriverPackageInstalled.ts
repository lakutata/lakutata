import {CacheDriverNotFoundException} from '../exceptions/CacheDriverNotFoundException.js'

export function IsDriverPackageInstalled(packageName: string): void {
    try {
        require.resolve(packageName)
    } catch (e) {
        throw new CacheDriverNotFoundException('Package "{packageName}" is required for this driver. Run "npm install {packageName}".', {packageName: packageName})
    }
}