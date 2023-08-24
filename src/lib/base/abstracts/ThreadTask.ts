import {BaseObject} from '../BaseObject'
import {InjectionProperties} from '../../../types/InjectionProperties'
import {isMainThread, Worker} from 'worker_threads'
import path from 'path'
import Module from 'module'
import {ModuleNotFoundException} from '../../../exceptions/ModuleNotFoundException'

export abstract class ThreadTask extends BaseObject {

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
        new Worker(path.resolve(__dirname, '../../ThreadContainer'), {
            workerData: {
                className: this.className,
                moduleId: moduleId,
                configurableProperties: configurableProperties
            }
        })
    }

    protected async __init(): Promise<void> {
        if (isMainThread) {
            await this.__setupWorkerThread()
        } else {
            //todo
            console.log('NMBMBNMBNMBNMBNMBNMBNMBNMBNMBNMNBMBNMBNMBNMBNMBNMBNMBNMBNMBNMBNMBNMBNM')
        }
    }

    /**
     * 对外暴露执行方法(需要传参)
     */
    public async run(): Promise<any> {
        //todo
    }

    /**
     * 线程任务执行器
     * @protected
     */
    protected abstract executor(workData: Record<string, any>): Promise<any>
}
