import {Configurable, Model, Time} from '../../Lakutata'
import chalk from 'chalk'
import {dirname} from 'path'

export class Info extends Model {

    @Configurable()
    protected readonly version: string

    @Configurable()
    protected readonly description: string

    @Configurable()
    protected readonly license: string

    protected readonly asciiLogo: string = '' +
        ' _                               _             _            \n' +
        '| |               _             | |           | |           \n' +
        '| |        __ _  | | _   _   _  | |_    __ _  | |_    __ _  \n' +
        '| |       / _` | | |/ / | | | | | __|  / _` | | __|  / _` | \n' +
        '| |____  | (_| | |   <  | |_| | \\ |_  | (_| | \\ |_  | (_| | \n' +
        '|______|  \\__,_| |_|\\_\\  \\__,_|  \\__|  \\__,_|  \\__|  \\__,_| \n' +
        '                                                            '

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
            `The installation directory path is ${chalk.underline(dirname(__dirname))}`,
            `Lakutata is ${chalk.cyan(this.license)} licensed.`,
            `Copyright (c) ${new Time().format('YYYY')} ${chalk.bold('Lakutata')}. All rights reserved.`
        ]
    }
}
