import {Component} from './Component'
import {InjectionProperties} from '../../types/InjectionProperties'
import {Configurable, Scoped} from '../../decorators/DependencyInjectionDecorators'
import {fork, ChildProcess} from 'child_process'
import path from 'path'
import Module from 'module'
import {ModuleNotFoundException} from '../../exceptions/ModuleNotFoundException'
import v8 from 'v8'
import {isAsyncFunction} from 'util/types'
import {createServer, IncomingMessage, Server, ServerResponse} from 'http'
import syncFetch from 'sync-fetch'
import asyncFetch from 'node-fetch'
import {GetPort} from '../../exports/Utilities'
import {format as URLFormat, parse as URLParse, UrlObject} from 'url'
import {parse as QueryParse, ParsedUrlQuery} from 'querystring'

@Scoped(true)
export class Process extends Component {

    protected declare __$$worker: ChildProcess

    protected declare __$$CServer: Server

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
        if (this.isPrimary) {
            const publicMethods: string[] = Object.getOwnPropertyNames(this.constructor.prototype)
                .filter((name: string) => typeof this.constructor.prototype[name] === 'function' && name !== 'constructor')
            publicMethods.forEach((publicMethod: string) => {
                const originMethod: Function = this[publicMethod]
                const isAsyncMethod: boolean = isAsyncFunction(originMethod)
                Object.defineProperty(this, publicMethod, {
                    get(): any {
                        const workerUrlObject: UrlObject = {
                            protocol: 'http',
                            hostname: 'localhost',
                            port: Reflect.getOwnMetadata(this.__$$worker, this.__$$worker)
                        }
                        return isAsyncMethod ? async (...args: any[]): Promise<any> => {
                            workerUrlObject.query = {
                                method: publicMethod,
                                args: v8.serialize(args).toString('base64')
                            }
                            const rawResponse: string = await (await asyncFetch(URLFormat(workerUrlObject))).text()
                            return v8.deserialize(Buffer.from(rawResponse, 'base64'))
                        } : (...args: any[]): any => {
                            workerUrlObject.query = {
                                method: publicMethod,
                                args: v8.serialize(args).toString('base64')
                            }
                            const rawResponse: string = syncFetch(URLFormat(workerUrlObject)).text()
                            return v8.deserialize(Buffer.from(rawResponse, 'base64'))
                        }
                    }
                })
            })
        }
        return this
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
        const workerCommunicationPort: number = await GetPort()
        await new Promise((resolve, reject) => {
            this.__$$worker = fork(path.resolve(__dirname, '../ProcessContainer'), [
                moduleId,
                this.className,
                v8.serialize(configs).toString('base64'),
                this.__generateWorkerId().toString(),
                workerCommunicationPort.toString()
            ], {
                env: Object.assign({}, process.env, {isWorkerProcess: true}),
                serialization: 'advanced'
            }).on('message', (args: any[]) => {
                this.once('ready', resolve)
                const eventName: string = args[0]
                const eventArgs: any[] = args.slice(1)
                this.emit(eventName, ...eventArgs)
            }).on('error', reject)
            Reflect.defineMetadata(this.__$$worker, workerCommunicationPort, this.__$$worker)
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
            await new Promise<void>((resolve, reject) => {
                try {
                    const workerCommunicationPortStr: string = process.argv[0]
                    this.__$$CServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
                        const parsedQuery: ParsedUrlQuery = QueryParse(URLParse(req.url!).query!)
                        const method: string = <string>(parsedQuery.method)
                        const args: any[] = v8.deserialize(Buffer.from(<string>(parsedQuery.args), 'base64'))
                        const returnValue: any = await this[method](...args)
                        res.write(v8.serialize(returnValue).toString('base64'))
                        res.end()
                    }).listen(parseInt(workerCommunicationPortStr), 'localhost', resolve)
                } catch (e) {
                    return reject(e)
                }
            })
        }
    }

    protected async __destroy(): Promise<void> {
        //todo 销毁进程
        return super.__destroy()
    }
}
