import {Inject, Interval, Logger} from '../../Lakutata'

export class SayHelloInterval extends Interval {

    @Inject('log')
    protected readonly log: Logger

    /**
     * 执行器
     * @protected
     */
    protected async executor(): Promise<void> {
        this.log.info('%s say "Hello!!!"', this.className)
    }

    /**
     * 销毁函数
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.log.info('%s destroyed', this.className)
    }
}
