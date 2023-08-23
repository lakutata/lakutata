import {BaseObject} from '../BaseObject'
import {Job, scheduleJob, cancelJob} from 'node-schedule'
import {Configurable} from '../../../decorators/DependencyInjectionDecorators'
import {Time} from '../../../exports/Time'
import {Accept} from '../../../decorators/ValidationDecorators'
import {Validator} from '../../../exports/Validator'

/**
 * 周期任务抽象类
 */
export abstract class Cron extends BaseObject {

    /**
     * 周期任务对象
     * @protected
     */
    protected _$job: Job | null = null

    /**
     * 周期任务运行指示器
     * @protected
     */
    protected _$executing: boolean = false

    /**
     * 是否被暂停
     * @protected
     */
    protected _$paused: boolean = false

    /**
     * 周期任务执行报错信息
     * @protected
     */
    protected _$lastError: Error | null = null

    /**
     * 周期任务表达式，默认为每秒一次
     */
    @Configurable()
    public readonly expression: string = '* * * * * ?'

    /**
     * 是否仅记录错误，不将错误扔出
     */
    @Configurable()
    public readonly silentError: boolean = true

    /**
     * 内部初始化函数
     * @protected
     */
    protected async __init(): Promise<void> {
        this._$job = this.createCronJob(this.expression)
    }

    /**
     * 创建定时任务对象
     * @param expression
     * @protected
     */
    @Accept(Validator.Cron())
    protected createCronJob(expression: string): Job {
        return scheduleJob(expression, async (fireDate: Date): Promise<void> => {
            if (this._$executing) return
            this._$executing = true
            try {
                await this.executor(new Time(fireDate))
            } catch (e) {
                this._$lastError = <Error>e
                if (!this.silentError) throw e
            } finally {
                this._$executing = false
            }
        })
    }

    /**
     * 内部销毁函数
     * @protected
     */
    protected async __destroy(): Promise<void> {
        if (this._$job) {
            cancelJob(this._$job)
            this._$job = null
        }
    }

    /**
     * 暂停周期任务执行
     */
    public pause(): this {
        this._$paused = true
        if (this._$job) {
            cancelJob(this._$job)
            this._$job = null
        }
        return this
    }

    /**
     * 周期任务是否已暂停执行
     */
    public isPaused(): boolean {
        return this._$paused
    }

    /**
     * 恢复周期任务执行
     */
    public resume(): this {
        this._$paused = false
        this._$job = this.createCronJob(this.expression)
        return this
    }

    /**
     * 周期任务是否正在执行中
     */
    public isExecuting(): boolean {
        return this._$executing
    }

    /**
     * 获取周期任务最新的错误信息
     */
    public getLastError(): Error | null {
        return this._$lastError
    }

    /**
     * 执行器
     */
    protected abstract executor(time: Time): Promise<void> | void
}
