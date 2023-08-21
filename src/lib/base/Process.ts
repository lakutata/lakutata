import {Component} from './Component'
import {InjectionProperties} from '../../types/InjectionProperties'
import {Configurable, Scoped} from '../../decorators/DependencyInjectionDecorators'
import {fork, ChildProcess} from 'child_process'
import path from 'path'
import Module from 'module'
import {ModuleNotFoundException} from '../../exceptions/ModuleNotFoundException'

process.on('message', console.log)

@Scoped(true)
export class Process extends Component {

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

    protected async __init(): Promise<void> {
        if (!process.env.isWorkerProcess) {
            const moduleId: string = this.__resolveSelfModuleId()
            const configurableProperties: string[] = await this.__getConfigurableProperties()
            const worker: ChildProcess = fork(path.resolve(__dirname, '../ProcessContainer'), [moduleId], {
                env: Object.assign({}, process.env, {isWorkerProcess: true}),
                serialization: 'advanced'
            })
            //todo 将属性数据传过去
        } else {
            //子进程该做的事情
        }
    }

    protected async __destroy(): Promise<void> {
        //todo 销毁进程
        return super.__destroy()
    }
}
