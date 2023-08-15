import 'reflect-metadata'
import {BaseObject} from '../BaseObject.js'
import {IsObjectInitialized} from '../../../Utilities.js'
import {clearInterval} from 'timers'
import {Configurable} from '../../../decorators/DependencyInjectionDecorators.js'
import {Validator} from '../../../Validator.js'

/**
 * 定时器抽象类
 */
export abstract class Interval extends BaseObject {
    /**
     * 周期调用器
     * @protected
     */
    protected _$interval: NodeJS.Timer | null

    /**
     * 执行器运行指示器
     * @protected
     */
    protected _$executing: number = 0

    /**
     * 是否被暂停
     * @protected
     */
    protected _$paused: boolean = false

    /**
     * 执行模式
     * SEQ 当一次执行结束后等待指定时间间隔后才会进行下一次执行
     * TIME 在指定的时间间隔后不管当前执行是否结束均进行下一次执行
     */
    @Configurable({accept: Validator.String().valid('SEQ', 'TIME')})
    public mode: 'SEQ' | 'TIME' = 'SEQ'

    /**
     * 执行时间间隔
     */
    @Configurable({
        onSet: function (this: Interval): void {
            if (this._$paused) return
            this.reloadJob()
        },
        accept: Validator.Number().min(1)
    })
    public interval: number = 1

    /**
     * 定义任务
     * @protected
     */
    protected defineJob(): void {
        this._$interval = setInterval(async (): Promise<void> => {
            if (!IsObjectInitialized(this) || this._$paused) return
            await this.runExecutor()
        }, this.interval)
    }

    /**
     * 重载任务
     * @protected
     */
    protected reloadJob(): void {
        if (this._$interval) clearInterval(this._$interval)
        this.defineJob()
    }

    /**
     * 运行执行器
     * @protected
     */
    protected async runExecutor(): Promise<void> {
        if (this.mode === 'SEQ' && !!this._$executing) return
        this._$executing += 1
        await this.executor()
        this._$executing -= 1
    }

    /**
     * 暂停周期调用器执行
     */
    public pause(): this {
        this._$paused = true
        if (this._$interval) clearInterval(this._$interval)
        this._$interval = null
        return this
    }

    /**
     * 调用器是否已暂停执行
     */
    public isPaused(): boolean {
        return this._$paused
    }

    /**
     * 恢复周期调用器执行
     */
    public resume(): this {
        this._$paused = false
        this.reloadJob()
        return this
    }

    /**
     * 调用器是否正在执行中
     */
    public isExecuting(): boolean {
        return !!this._$executing
    }

    /**
     * 销毁函数
     * @protected
     */
    protected async destroy(): Promise<void> {
        if (this._$interval) clearInterval(this._$interval)
        this._$interval = null
    }

    /**
     * 执行器
     */
    protected abstract executor(): Promise<void> | void
}
