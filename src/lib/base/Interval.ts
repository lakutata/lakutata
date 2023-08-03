import {BaseObject} from './BaseObject.js'
import {IsObjectInitialized} from '../../Utilities.js'
import {clearInterval} from 'timers'
import {Configurable} from '../../decorators/DependencyInjectionDecorators.js'

export class Interval extends BaseObject {
    /**
     * 周期调用器
     * @protected
     */
    protected _interval: NodeJS.Timer = setInterval(() => {
        if (!IsObjectInitialized(this)) return
        //todo
    }, 10)

    @Configurable()
    public set interval(ms: number) {
        this.setProperty('$ms', ms)
    }

    public get interval(): number {
        return this.getProperty<number>('$ms')
    }


    protected async init(): Promise<void> {
        console.log('this.interval:', this.interval)
        // console.log('%^&%^&%^&%^&')
    }

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
