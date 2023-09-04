import {Cron, Inject, Logger, Time} from '../../Lakutata'

export class GreetCron extends Cron {

    @Inject()
    protected readonly log: Logger

    protected executor(time: Time): Promise<void> | void {
        this.log.info('Oh my baby! %s', time)
    }

    /**
     * 销毁函数
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.log.info('%s destroyed', this.className)
    }
}
