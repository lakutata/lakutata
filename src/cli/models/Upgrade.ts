import {Configurable, Inject, Model} from '../../Lakutata'
import chalk from 'chalk'
import {$} from 'execa'
import cliSpinners, {Spinner} from 'cli-spinners'
import logUpdate from 'log-update'
import latestVersion from 'latest-version'
import {gt as isVersionGreaterThan} from 'semver'
import {PackageLevel} from '../components/PackageLevel'

export class Upgrade extends Model {

    @Inject('packageLevel')
    protected readonly packageLevel: PackageLevel

    @Configurable()
    protected readonly version: string

    @Configurable()
    protected readonly name: string

    protected spinnerInterval: NodeJS.Timer | null = null

    /**
     * 初始化函数
     * @protected
     */
    protected async init(): Promise<void> {
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
            onlineLatestVersion = await latestVersion(this.name)
            this.stopSpinner()
        } catch (e) {
            return
        }
        if (isVersionGreaterThan(onlineLatestVersion, this.version)) return onlineLatestVersion
    }

    public async upgradeInstall() {

    }
}
