import {BaseObject} from '../BaseObject'
import {InjectionProperties} from '../../../types/InjectionProperties'
import {isMainThread, ResourceLimits} from 'worker_threads'
import path from 'path'
import Module from 'module'
import {ModuleNotFoundException} from '../../../exceptions/ModuleNotFoundException'
import Piscina from 'piscina'
import {Configurable, Inject, Scoped} from '../../../decorators/DependencyInjectionDecorators'
import {IllegalMethodCallException} from '../../../exceptions/IllegalMethodCallException'
import {Transform, TransformCallback} from 'stream'
import {Logger} from '../../components/Logger'
import {RandomString} from '../../../Helper'

@Scoped(true)
export abstract class ThreadTask extends BaseObject {

    @Inject('log')
    protected readonly log: Logger

    /**
     * 最小线程数
     * @protected
     */
    @Configurable()
    protected readonly minThreads: number = 1

    /**
     * 最大线程数
     * @protected
     */
    @Configurable()
    protected readonly maxThreads: number = 1

    /**
     * 线程资源限制
     * @protected
     */
    @Configurable()
    protected readonly resourceLimits?: ResourceLimits = undefined

    /**
     * 构造函数
     * @param properties
     */
    constructor(properties: InjectionProperties = {}) {
        super(properties)
        this.setInternalProperty('type', 'ThreadTask')
    }

    /**
     * 查找子类自身的模块ID信息
     * @private
     */
    private __resolveSelfModuleId(): string {
        const moduleCache = Module['_cache']
        const moduleId: string | undefined = Object.keys(moduleCache).find((_moduleId: string) => new RegExp(this.className).test(_moduleId) && moduleCache[_moduleId]?.exports[this.className] === this.constructor)
        if (!moduleId || typeof moduleId !== 'string') throw new ModuleNotFoundException('The thread task module named "{className}" is not found, unable to create thread task.', {className: this.className})
        return moduleCache[moduleId].id
    }

    /**
     * 建立Worker子线程
     * @protected
     */
    protected async __setupWorkerThread(): Promise<void> {
        const moduleId: string = this.__resolveSelfModuleId()
        const configurableProperties: string[] = await this.__getConfigurableProperties()
        const configs: Record<string, any> = {}
        configurableProperties.forEach((propertyKey: string) => configs[propertyKey] = this[propertyKey])
        const loggerEvent = `__$$${RandomString(16)}_`
        const threadPool: Piscina = new Piscina({
            minThreads: this.minThreads,
            maxThreads: this.maxThreads,
            maxQueue: 'auto',
            filename: require.resolve(path.resolve(__dirname, '../../worker/ThreadContainer')),
            useAtomics: true,
            resourceLimits: this.resourceLimits ? this.resourceLimits : undefined,
            workerData: {
                className: this.className,
                moduleId: moduleId,
                configurableProperties: configurableProperties,
                loggerEvent: loggerEvent
            }
        })
        threadPool.on('message', (args: any[]): void => {
            const eventName: string = args[0]
            const eventArgs: any[] = args.slice(1)
            //处理日志事件
            if (eventName === loggerEvent) {
                const loggerMethod: string = eventArgs[0]
                const loggerArgs: any[] = eventArgs.slice(1)
                this.log[loggerMethod](...loggerArgs)
            }
        })
        this.setInternalProperty('threadPool', threadPool)
    }

    /**
     * 内部初始化函数
     * @protected
     */
    protected async __init(): Promise<void> {
        if (isMainThread) {
            await this.__setupWorkerThread()
        }
    }

    /**
     * 内部销毁函数
     * @protected
     */
    protected async __destroy(): Promise<void> {
        if (isMainThread) {
            await this.getInternalProperty<Piscina | undefined>('threadPool')?.destroy()
        }
    }

    /**
     * 对外暴露执行方法
     * @param inp
     */
    public async run(inp?: any): Promise<any> {
        if (isMainThread) {
            return await this.getInternalProperty<Piscina>('threadPool').run(inp)
        } else {
            return await this.executor(inp)
        }
    }

    /**
     * 流数据处理方法
     */
    public createStreamHandler(): Transform {
        if (!isMainThread) throw new IllegalMethodCallException('Stream handler can only be used in the main thread.')
        const threadPool: Piscina = this.getInternalProperty<Piscina>('threadPool')
        const transform: Transform = new Transform({
            transform(chunk: any, encoding: BufferEncoding, callback: TransformCallback): void {
                threadPool.run(chunk).then(handledChunk => callback(null, handledChunk)).catch(error => callback(error))
                if (threadPool.queueSize === threadPool.options.maxQueue) this.pause()
            }
        })
        const resumeTransform = (): void => {
            if (transform.isPaused()) transform.resume()
        }
        threadPool.on('drain', resumeTransform)
        transform.once('close', () => {
            threadPool.removeListener('drain', resumeTransform)
        })
        return transform
    }

    /**
     * 线程任务执行器
     * @param inp
     * @protected
     */
    protected abstract executor(inp?: any): Promise<any>
}
