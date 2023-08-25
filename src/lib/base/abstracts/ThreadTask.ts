import {BaseObject} from '../BaseObject'
import {InjectionProperties} from '../../../types/InjectionProperties'
import {isMainThread} from 'worker_threads'
import path from 'path'
import Module from 'module'
import {ModuleNotFoundException} from '../../../exceptions/ModuleNotFoundException'
import Piscina from 'piscina'
import {Configurable, Scoped} from '../../../decorators/DependencyInjectionDecorators'
import os from 'node:os'

// @ts-ignore
@Scoped(true)
export abstract class ThreadTask extends BaseObject {

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
    protected readonly maxThreads: number = os.cpus().length

    constructor(properties: InjectionProperties = {}) {
        super(properties)
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
        const threadPool: Piscina = new Piscina({
            minThreads: this.minThreads,
            maxThreads: this.maxThreads,
            filename: require.resolve(path.resolve(__dirname, '../../ThreadContainer')),
            useAtomics: true,
            workerData: {
                className: this.className,
                moduleId: moduleId,
                configurableProperties: configurableProperties
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
    public async run(inp?: Record<string, any>): Promise<any> {
        if (isMainThread) {
            return await this.getInternalProperty<Piscina>('threadPool').run(inp)
        } else {
            return await this.executor(inp)
        }
    }

    /**
     * 线程任务执行器
     * @param inp
     * @protected
     */
    protected abstract executor(inp?: Record<string, any>): Promise<any>
}
