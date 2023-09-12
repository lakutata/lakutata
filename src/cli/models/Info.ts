import {Configurable, Inject, Model, Time} from '../../Lakutata'
import chalk from 'chalk'
import {PackageLevel} from '../components/PackageLevel'

export class Info extends Model {

    @Inject()
    protected readonly packageLevel: PackageLevel

    @Configurable()
    protected readonly description: string

    @Configurable()
    protected readonly license: string

    @Configurable()
    protected readonly asciiLogo: string

    @Configurable()
    protected version: string

    public lines: string[] = []

    /**
     * 初始化函数
     * @protected
     */
    protected async init(): Promise<void> {
        const version: string | null = await this.packageLevel.getInstalledPackageVersion()
        this.version = version ? version : this.version
        this.lines = [
            chalk.dim(chalk.bold(this.asciiLogo)),
            `${chalk.bold('Lakutata')} is ${chalk.blue(this.description)}`,
            `The current version is ${chalk.bold(this.version)}`,
            `The installation directory path is ${chalk.underline(this.packageLevel.getInstallPath())}`,
            `Currently running at ${chalk.bold(this.packageLevel.getLevel())} level`,
            `Lakutata is ${chalk.cyan(this.license)} licensed.`,
            `Copyright (c) ${new Time().format('YYYY')} ${chalk.bold('Lakutata')}. All rights reserved.`
        ]
    }
}
