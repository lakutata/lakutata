import {BaseObject, Configurable} from '../../Lakutata'
import {gt as isVersionGreaterThan, prerelease} from 'semver'
import latestVersion from 'latest-version'

export class OnlineLatestVersion extends BaseObject {

    @Configurable()
    protected readonly version: string

    @Configurable()
    protected readonly name: string

    /**
     * 获取包名
     */
    public getName(): string {
        return this.name
    }

    /**
     * 获取线上最新版本
     */
    public async getVersion(): Promise<string> {
        let onlineLatestVersion: string
        const prereleaseInfo: ReadonlyArray<string | number> | null = prerelease(this.version)
        if (prereleaseInfo && prereleaseInfo[0]) {
            onlineLatestVersion = await latestVersion(this.name, {version: prereleaseInfo[0].toString()})
        } else {
            onlineLatestVersion = await latestVersion(this.name)
        }
        return isVersionGreaterThan(onlineLatestVersion, this.version) ? onlineLatestVersion : this.version
    }
}
