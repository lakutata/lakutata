import {Configurable, Model, Time} from '../../Lakutata'
import chalk from 'chalk'
import {EOL} from 'os'

export class Info extends Model {

    @Configurable()
    protected readonly version: string

    @Configurable()
    protected readonly description: string

    @Configurable()
    protected readonly license: string

    public lines: string[] = []

    /**
     * 初始化函数
     * @protected
     */
    protected async init(): Promise<void> {
        this.lines = [
            chalk.green('hahahah'),
            EOL,
            `Lakutata is ${this.license} licensed.`,
            `Copyright (c) ${new Time().format('YYYY')} Lakutata`
        ]
        //Lakutata is MIT licensed.
        //Copyright (c) 2023-present Lakutata
        //项目简介文本
        //安装位置
        //程序版本
        //
    }
}
