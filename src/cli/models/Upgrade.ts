import {Configurable, Inject, Model} from '../../Lakutata'
import chalk from 'chalk'
import {$, execa} from 'execa'
import cliSpinners, {Spinner} from 'cli-spinners'
import logUpdate from 'log-update'
import latestVersion from 'latest-version'
import {gt as isVersionGreaterThan, prerelease} from 'semver'
import {PackageLevel} from '../components/PackageLevel'

export class Upgrade extends Model {

    @Inject('packageLevel')
    protected readonly packageLevel: PackageLevel

    @Configurable()
    protected readonly name: string

    @Configurable()
    protected version: string

    protected spinnerInterval: NodeJS.Timer | null = null

    /**
     * 初始化函数
     * @protected
     */
    protected async init(): Promise<void> {
        const version: string | null = await this.packageLevel.getInstalledPackageVersion()
        this.version = version ? version : this.version
        this.spinnerInterval = null
    }

    /**
     * 销毁函数
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.stopSpinner()
    }

    /**
     * 开启spinner
     * @param spinner
     * @param description
     * @protected
     */
    protected startSpinner(spinner: Spinner, description?: string) {
        this.stopSpinner()
        let i: number = 0
        this.spinnerInterval = setInterval(() => {
            const {frames} = spinner
            const text: string = description ? `${frames[i = ++i % frames.length]} ${description}` : frames[i = ++i % frames.length]
            logUpdate(text)
        }, spinner.interval)
    }

    /**
     * 关闭spinner
     * @protected
     */
    protected stopSpinner() {
        if (this.spinnerInterval) {
            clearInterval(this.spinnerInterval)
            this.spinnerInterval = null
            logUpdate.clear()
        }
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
        this.startSpinner(cliSpinners.dots, 'Checking for updates')
        let onlineLatestVersion: string
        try {
            if (!(await this.isNpmCommandAvailable())) return this.stopSpinner()
            const prereleaseInfo: ReadonlyArray<string | number> | null = prerelease(this.version)
            if (prereleaseInfo && prereleaseInfo[0]) {
                onlineLatestVersion = await latestVersion(this.name, {version: prereleaseInfo[0].toString()})
            } else {
                onlineLatestVersion = await latestVersion(this.name)
            }
            this.stopSpinner()
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
        this.startSpinner(cliSpinners.dots, 'Installing upgrade')
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
            this.stopSpinner()
            console.info(chalk.green(`Upgrade successful. Upgraded to version ${upgradeVersion}`))
        } catch (e) {
            this.stopSpinner()
            console.error(chalk.red('Upgrade failed. Please try manual upgrade:'))
            console.info(chalk.bgGreen(chalk.white(upgradeCommand)))
        }
    }
}
