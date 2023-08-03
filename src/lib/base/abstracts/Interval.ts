import {BaseObject} from '../BaseObject.js'
import {IsObjectInitialized} from '../../../Utilities.js'
import {clearInterval} from 'timers'
import {Configurable} from '../../../decorators/DependencyInjectionDecorators.js'
import {Validator} from '../../../Validator.js'

export abstract class Interval extends BaseObject {
    /**
     * 周期调用器
     * @protected
     */
    protected _interval: NodeJS.Timer = setInterval(() => {
        if (!IsObjectInitialized(this)) return
        //todo
    }, 10)

    /**
     * 执行模式
     * ONE_BY_ONE 当一次执行结束后等待指定时间间隔后才会进行下一次执行
     * TIME_BY_TIME 在指定的时间间隔后不管当前执行是否结束均进行下一次执行
     */
    @Configurable({accept: Validator.String().valid('ONE_BY_ONE', 'TIME_BY_TIME')})
    public readonly mode: 'ONE_BY_ONE' | 'TIME_BY_TIME' = 'ONE_BY_ONE'

    /**
     * 执行时间间隔
     */
    @Configurable({
        onSet: function (this: Interval): void {
            //todo 重载定时任务
        },
        accept: Validator.Number().min(1)
    })
    public interval: number = 1

    protected async init(): Promise<void> {
        console.log('this.interval:', this.interval)
    }

    /**
     * 执行器
     */
    protected abstract executor(): Promise<void> | void

    /**
     * 暂停周期调用器执行
     */
    public pause(): this {
        //todo
        return this
    }

    /**
     * 恢复周期调用器执行
     */
    public resume(): this {
        //todo
        return this
    }

    /**
     * 销毁函数
     * @protected
     */
    protected async destroy(): Promise<void> {
        clearInterval(this._interval)
    }
}
