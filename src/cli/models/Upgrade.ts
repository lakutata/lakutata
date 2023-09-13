import {Configurable, Inject, Model} from '../../Lakutata'
import chalk from 'chalk'
import {$, execa} from 'execa'
import latestVersion from 'latest-version'
import {gt as isVersionGreaterThan, prerelease} from 'semver'
import {PackageLevel} from '../components/PackageLevel'
import {Spinner} from '../components/Spinner'

export class Upgrade extends Model {

    @Inject('spinner')
    protected readonly spinner: Spinner

    @Inject('packageLevel')
    protected readonly packageLevel: PackageLevel

    @Configurable()
    protected readonly name: string

    @Configurable()
    protected version: string

    /**
     * 初始化函数
     * @protected
     */
    protected async init(): Promise<void> {
        const version: string | null = await this.packageLevel.getInstalledPackageVersion()
        this.version = version ? version : this.version
    }

    /**
     * 判断当前环境NPM是否可用
     * @protected
     */
    protected async isNpmCommandAvailable(): Promise<boolean> {
        try {
            await $`npm --version`
            return true
        } catch (e) {
            return false
        }
    }

    /**
     * 输出当前版本
     */
    public echoCurrentVersion(): void {
        console.info(`The current version is ${chalk.bold(this.version)}`)
    }

    /**
     * 输出没有可用更新
     */
    public echoNoUpdateAvailable(): void {
        console.info(chalk.green('No updates available.'))
    }

    /**
     * 检查更新
     */
    public async checkUpdate(): Promise<string | void> {
        this.spinner.start('Checking for updates')
        let onlineLatestVersion: string
        try {
            if (!(await this.isNpmCommandAvailable())) return this.spinner.stop()
            const prereleaseInfo: ReadonlyArray<string | number> | null = prerelease(this.version)
            if (prereleaseInfo && prereleaseInfo[0]) {
                onlineLatestVersion = await latestVersion(this.name, {version: prereleaseInfo[0].toString()})
            } else {
                onlineLatestVersion = await latestVersion(this.name)
            }
            this.spinner.stop()
        } catch (e) {
            return
        }
        if (isVersionGreaterThan(onlineLatestVersion, this.version)) return onlineLatestVersion
    }

    /**
     * 执行升级安装
     * @param upgradeVersion
     */
    public async upgradeInstall(upgradeVersion: string): Promise<void> {
        this.spinner.start('Installing upgrade')
        let upgradeCommand: string
        let cwd: string | null = null
        if (this.packageLevel.getLevel() === 'GLOBAL') {
            upgradeCommand = `npm install -g ${this.name}@${upgradeVersion}`
        } else {
            cwd = this.packageLevel.getRoot()
            upgradeCommand = `npm install ${this.name}@${upgradeVersion}`
        }
        try {
            const upgradeCommandArgs: string[] = upgradeCommand.split(' ')
            upgradeCommandArgs.shift()
            if (cwd) {
                await execa('npm', upgradeCommandArgs, {cwd: cwd})
            } else {
                await execa('npm', upgradeCommandArgs)
            }
            this.spinner.stop()
            console.info(chalk.green(`Upgrade successful. Upgraded to version ${upgradeVersion}`))
        } catch (e) {
            this.spinner.stop()
            console.error(chalk.red('Upgrade failed. Please try manual upgrade:'))
            console.info(chalk.bgGreen(chalk.white(upgradeCommand)))
        }
    }
}
