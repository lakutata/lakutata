import {Configurable, Inject, Model, Time} from '../../Lakutata'
import chalk from 'chalk'
import {PackageLevel} from '../components/PackageLevel'

export class Info extends Model {

    @Inject()
    protected readonly packageLevel: PackageLevel

    @Configurable()
    protected readonly version: string

    @Configurable()
    protected readonly description: string

    @Configurable()
    protected readonly license: string

    @Configurable()
    protected readonly asciiLogo: string

    public lines: string[] = []

    /**
     * 初始化函数
     * @protected
     */
    protected async init(): Promise<void> {
        this.lines = [
            chalk.dim(chalk.bold(this.asciiLogo)),
            `${chalk.bold('Lakutata')} is ${chalk.blue(this.description)}`,
            `The current version is ${chalk.bold(this.version)}`,
            // `The installation directory path is ${chalk.underline(dirname(__dirname))}`,
            `The installation directory path is ${chalk.underline(this.packageLevel.getInstallPath())}`,
            `Lakutata is ${chalk.cyan(this.license)} licensed.`,
            `Copyright (c) ${new Time().format('YYYY')} ${chalk.bold('Lakutata')}. All rights reserved.`
        ]
    }
}
