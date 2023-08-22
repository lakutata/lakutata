import {Component} from './Component'
import {InjectionProperties} from '../../types/InjectionProperties'
import {Configurable, Scoped} from '../../decorators/DependencyInjectionDecorators'
import {fork, ChildProcess} from 'child_process'
import path from 'path'
import Module from 'module'
import {ModuleNotFoundException} from '../../exceptions/ModuleNotFoundException'
import {IProcessWorkerEventPacket} from '../../interfaces/IProcessWorkerEventPacket'
import * as v8 from 'v8'

process.on('message', console.log)

@Scoped(true)
export class Process extends Component {

    /**
     * 判断当前是否在主进程
     * @protected
     */
    protected readonly isPrimary: boolean = !process.env.isWorkerProcess

    /**
     * 判断当前是否在子进程
     * @protected
     */
    protected readonly isWorker: boolean = !!process.env.isWorkerProcess

    @Configurable()
    public readonly concurrent: number = 1

    /**
     * Constructor
     * @param properties
     */
    constructor(properties: InjectionProperties = {}) {
        super(properties)
        this.setInternalProperty('type', 'Process')
    }

    /**
     * 查找子类自身的模块ID信息
     * @private
     */
    private __resolveSelfModuleId(): string {
        const moduleCache = Module['_cache']
        const moduleId: string | undefined = Object.keys(moduleCache).find((_moduleId: string) => new RegExp(this.className).test(_moduleId) && moduleCache[_moduleId]?.exports[this.className] === this.constructor)
        if (!moduleId || typeof moduleId !== 'string') throw new ModuleNotFoundException('The child process module named "{className}" is not found, unable to create child process.', {className: this.className})
        return moduleCache[moduleId].id
    }

    /**
     * 生成Worker子进程ID
     * @private
     */
    private __generateWorkerId(): number {
        const workerId: number = this.getInternalProperty('workerId', 0) + 1
        this.setInternalProperty('workerId', workerId)
        return workerId
    }

    /**
     * 建立Worker子进程
     * @protected
     */
    protected async __setupWorker(): Promise<void> {
        const moduleId: string = this.__resolveSelfModuleId()
        const configurableProperties: string[] = await this.__getConfigurableProperties()
        const configs: Record<string, any> = {}
        configurableProperties.forEach((propertyKey: string) => configs[propertyKey] = this[propertyKey])
        const worker: ChildProcess = fork(path.resolve(__dirname, '../ProcessContainer'), [
            moduleId,
            this.className,
            v8.serialize(configs).toString('base64'),
            this.__generateWorkerId().toString()
        ], {
            env: Object.assign({}, process.env, {isWorkerProcess: true}),
            serialization: 'advanced'
        })
    }

    /**
     * 内部初始化函数
     * @protected
     */
    protected async __init(): Promise<void> {
        if (this.isPrimary) {
            await this.__setupWorker()
        } else {
            //子进程该做的事情
            console.log(this.concurrent)
        }
    }

    protected __emitWorkerEvent(worker: ChildProcess, eventPacket: IProcessWorkerEventPacket) {

    }

    protected async __destroy(): Promise<void> {
        //todo 销毁进程
        return super.__destroy()
    }
}
