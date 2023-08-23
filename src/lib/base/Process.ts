import {Component} from './Component'
import {InjectionProperties} from '../../types/InjectionProperties'
import {Configurable, Scoped} from '../../decorators/DependencyInjectionDecorators'
import {ChildProcess, fork} from 'child_process'
import path from 'path'
import Module from 'module'
import {ModuleNotFoundException} from '../../exceptions/ModuleNotFoundException'
import v8 from 'v8'
import {isAsyncFunction} from 'util/types'
import {createServer, IncomingMessage, Server, ServerResponse} from 'http'
import syncFetch from 'sync-fetch'
import asyncFetch from 'node-fetch'
import {GetPort, RandomString} from '../../exports/Utilities'
import {format as URLFormat, parse as URLParse, UrlObject, UrlWithParsedQuery} from 'url'
import {ParsedUrlQuery} from 'querystring'
import {AppendAsyncConstructor} from './async-constructor/Append'
import {BaseObject} from './BaseObject'
import {EventEmitter} from 'events'

@Scoped(true)
export class Process extends Component {

    @Configurable()
    public readonly concurrent: number

    /**
     * Constructor
     * @param properties
     */
    constructor(properties: InjectionProperties = {}) {
        super(properties)
        this.setInternalProperty('type', 'Process')
        AppendAsyncConstructor(this, async (): Promise<void> => {
            if (!this.isWorker()) {
                const publicMethods: string[] = Object.getOwnPropertyNames(this.constructor.prototype).filter((name: string) => typeof this.constructor.prototype[name] === 'function' && name !== 'constructor')
                publicMethods.forEach((publicMethod: string): void => {
                    const originMethod: Function = this[publicMethod]
                    const isAsyncMethod: boolean = isAsyncFunction(originMethod)
                    Object.defineProperty(this, publicMethod, {
                        get: (): any => {
                            const workerUrlObject: UrlObject = {
                                protocol: 'http',
                                hostname: 'localhost',
                                pathname: '/call',
                                port: this.getInternalProperty('workerCommunicationPort')
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
                const properties: string[] = this.propertyNames().filter((propertyName: string) => {
                    return !publicMethods.includes(propertyName)
                        && !(typeof this[propertyName] === 'function')
                        && !(this[propertyName] instanceof BaseObject)
                })
                properties.forEach((propertyKey: string): void => {
                    const originDescriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(this, propertyKey)
                    this.setInternalProperty(`__${propertyKey}`, originDescriptor?.value)
                    Object.defineProperty(this, propertyKey, {
                        get: (): any => {
                            const getWorkerPropertyValueUrlObject: UrlObject = {
                                protocol: 'http',
                                hostname: 'localhost',
                                pathname: '/prop',
                                port: this.getInternalProperty('workerCommunicationPort'),
                                query: {
                                    key: propertyKey,
                                    type: 'get'
                                }
                            }
                            //从worker处取值
                            const propertyValue: any = v8.deserialize(Buffer.from(syncFetch(URLFormat(getWorkerPropertyValueUrlObject)).text(), 'base64'))
                            this.setInternalProperty(`__${propertyKey}`, propertyValue)
                            return this.getInternalProperty(`__${propertyKey}`, undefined)
                        },
                        set: (value: any): void => {
                            const setWorkerPropertyValueUrlObject: UrlObject = {
                                protocol: 'http',
                                hostname: 'localhost',
                                pathname: '/prop',
                                port: this.getInternalProperty('workerCommunicationPort'),
                                query: {
                                    key: propertyKey,
                                    type: 'set',
                                    value: v8.serialize(value).toString('base64')
                                }
                            }
                            this.setInternalProperty(`__${propertyKey}`, value)
                            //同步至worker
                            syncFetch(URLFormat(setWorkerPropertyValueUrlObject))
                        }
                    })
                })
            }
        })
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
     * 判断是否为子进程
     * @protected
     */
    protected isWorker(): boolean {
        return !!process.env.isWorkerProcess
    }

    /**
     * 建立Worker子进程
     * @protected
     */
    protected async __setupWorkerProcess(): Promise<void> {
        this.setInternalProperty('preventDefaultInit', true)//在主进程内不执行init()初始化方法
        const moduleId: string = this.__resolveSelfModuleId()
        const configurableProperties: string[] = await this.__getConfigurableProperties()
        const configs: Record<string, any> = {}
        configurableProperties.forEach((propertyKey: string) => configs[propertyKey] = this[propertyKey])
        const workerCommunicationPort: number = await GetPort()
        const loggerEvent: string = `__$$${RandomString(16)}_`
        await new Promise((resolve, reject) => {
            this.once('ready', resolve)
            const worker: ChildProcess = fork(path.resolve(__dirname, '../ProcessContainer'), [
                moduleId,
                this.className,
                v8.serialize(configs).toString('base64'),
                this.__generateWorkerId().toString(),
                loggerEvent,
                workerCommunicationPort.toString()
            ], {
                env: Object.assign({}, process.env, {isWorkerProcess: true}),
                serialization: 'advanced'
            }).on('message', (args: any[]): void => {
                const eventName: string = args[0]
                const eventArgs: any[] = args.slice(1)
                //处理日志事件
                if (eventName === loggerEvent) {
                    const loggerMethod: string = eventArgs[0]
                    const loggerArgs: any[] = eventArgs.slice(1)
                    this.log[loggerMethod](...loggerArgs)
                } else {
                    this.getInternalProperty<EventEmitter>('eventEmitter').emit(eventName, ...eventArgs)
                }
            }).on('error', reject)
            this.emit = (eventName: string | symbol, ...args: any[]): boolean => worker.send([eventName, ...args])
            this.setInternalProperty('worker', worker)
            this.setInternalProperty('workerCommunicationPort', workerCommunicationPort)
        })
    }

    /**
     * 在子进程中执行进程初始化工作
     * @protected
     */
    protected async __initWorkerProcess(): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            try {
                const workerCommunicationPortStr: string = process.argv[0]
                this.setInternalProperty('CServer', createServer(async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
                    const parsedURL: UrlWithParsedQuery = URLParse(req.url!, true)
                    const parsedQuery: ParsedUrlQuery = parsedURL.query
                    switch (parsedURL.pathname) {
                        case '/call': {
                            const method: string = <string>(parsedQuery.method)
                            const args: any[] = v8.deserialize(Buffer.from(<string>(parsedQuery.args), 'base64'))
                            const returnValue: any = await this[method](...args)
                            res.write(v8.serialize(returnValue).toString('base64'))
                        }
                            break
                        case '/prop': {
                            const propertyKey: string = <string>(parsedQuery.key)
                            if (parsedQuery.type === 'set') {
                                this[propertyKey] = v8.deserialize(Buffer.from(<string>(parsedQuery.value), 'base64'))
                                res.write(v8.serialize(undefined).toString('base64'))
                            } else if (parsedQuery.type === 'get') {
                                res.write(v8.serialize(this[propertyKey]).toString('base64'))
                            } else {
                                res.write(v8.serialize(undefined).toString('base64'))
                            }
                        }
                            break
                        default: {
                            res.write(v8.serialize(undefined).toString('base64'))
                        }
                    }
                    res.end()
                }).listen(parseInt(workerCommunicationPortStr), 'localhost', resolve))
                this.emit = (eventName: string | symbol, ...args: any[]): boolean => {
                    const processSendResult: boolean = process.send!([eventName, ...args])
                    const eventEmitterSendResult: boolean = this.getInternalProperty<EventEmitter>('eventEmitter').emit(eventName, ...args)
                    return processSendResult && eventEmitterSendResult
                }
                //处理父进程传入的事件
                process.on('message', (args: any[]): void => {
                    const eventName: string = args[0]
                    const eventArgs: any[] = args.slice(1)
                    this.emit(eventName, ...eventArgs)
                })
            } catch (e) {
                return reject(e)
            }
        })
    }

    /**
     * 内部初始化函数
     * @protected
     */
    protected async __init(): Promise<void> {
        await super.__init()
        this.isWorker() ? await this.__initWorkerProcess() : await this.__setupWorkerProcess()
    }

    /**
     * 内部销毁函数
     * @protected
     */
    protected async __destroy(): Promise<void> {
        if (this.hasInternalProperty('CServer')) await new Promise<void>(resolve => this.getInternalProperty<Server>('CServer').close(() => resolve()))
        if (this.hasInternalProperty('worker')) {
            this.getInternalProperty<ChildProcess>('worker').removeAllListeners()
            this.getInternalProperty<ChildProcess>('worker').kill()
        }
        return super.__destroy()
    }
}
