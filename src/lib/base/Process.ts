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
import {GetPort, RandomString, ThrowIntoBlackHole} from '../../exports/Utilities'
import {format as URLFormat, parse as URLParse, UrlObject, UrlWithParsedQuery} from 'url'
import {ParsedUrlQuery} from 'querystring'
import {AppendAsyncConstructor} from './async-constructor/Append'
import {BaseObject} from './BaseObject'
import {EventEmitter} from 'events'
import {ChildProcessUnavailableException} from '../../exceptions/ChildProcessUnavailableException'

@Scoped(true)
export class Process extends Component {

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
                                try {
                                    workerUrlObject.query = {
                                        method: publicMethod,
                                        args: v8.serialize(args).toString('base64')
                                    }
                                    const rawResponse: string = await (await asyncFetch(URLFormat(workerUrlObject))).text()
                                    return v8.deserialize(Buffer.from(rawResponse, 'base64'))
                                } catch (e) {
                                    throw new ChildProcessUnavailableException('Child process is currently unavailable')
                                }
                            } : (...args: any[]): any => {
                                try {
                                    workerUrlObject.query = {
                                        method: publicMethod,
                                        args: v8.serialize(args).toString('base64')
                                    }
                                    const rawResponse: string = syncFetch(URLFormat(workerUrlObject)).text()
                                    return v8.deserialize(Buffer.from(rawResponse, 'base64'))
                                } catch (e) {
                                    throw new ChildProcessUnavailableException('Child process is currently unavailable')
                                }
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
                            try {
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
                            } catch (e) {
                                return undefined
                            }
                        },
                        set: (value: any): void => {
                            try {
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
                            } catch (e) {
                                ThrowIntoBlackHole(e)
                            }
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
        this.getInternalProperty<ChildProcess | undefined>('worker')?.kill('SIGKILL')//避免上一个进程未关闭，发送强制关闭信号
        this.setInternalProperty('preventDefaultInit', true)//在主进程内不执行init()初始化方法
        const moduleId: string = this.__resolveSelfModuleId()
        const configurableProperties: string[] = await this.__getConfigurableProperties()
        const configs: Record<string, any> = {}
        configurableProperties.forEach((propertyKey: string) => configs[propertyKey] = this[propertyKey])
        const loggerEvent: string = `__$$${RandomString(16)}_`
        await new Promise((resolve, reject) => {
            this.once('ready', resolve)
            const worker: ChildProcess = fork(path.resolve(__dirname, '../ProcessContainer'), [
                moduleId,
                this.className,
                v8.serialize(configs).toString('base64'),
                this.__generateWorkerId().toString(),
                loggerEvent,
                this.getInternalProperty<number>('workerCommunicationPort').toString()
            ], {
                env: Object.assign({}, process.env, {isWorkerProcess: true}),
                serialization: 'advanced'
            })
                .on('message', (args: any[]): void => {
                    const eventName: string = args[0]
                    const eventArgs: any[] = args.slice(1)
                    //处理日志事件
                    if (eventName === loggerEvent) {
                        const loggerMethod: string = eventArgs[0]
                        const loggerArgs: any[] = eventArgs.slice(1)
                        this.log[loggerMethod](...loggerArgs)
                    } else {
                        if (eventName === '__$psError') {
                            //子进程发生崩溃错误，重启子进程
                            this.__setupWorkerProcess()
                        } else {
                            this.getInternalProperty<EventEmitter>('eventEmitter').emit(eventName, ...eventArgs)
                        }
                    }
                })
                .on('exit', (code, signal) => {
                    if (this.getInternalProperty('daemonizeWorker', false)) {
                        //子进程退出，重启子进程
                        this.__setupWorkerProcess()
                    }
                })
                .on('error', reject)
            this.emit = (eventName: string | symbol, ...args: any[]): boolean => worker.send([eventName, ...args])
            this.setInternalProperty('worker', worker)
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
        this.setInternalProperty('daemonizeWorker', true)
        if (!this.isWorker()) {
            this.setInternalProperty('workerCommunicationPort', await GetPort())
            await this.__setupWorkerProcess()
        } else {
            await this.__initWorkerProcess()
        }
    }

    /**
     * 内部销毁函数
     * @protected
     */
    protected async __destroy(): Promise<void> {
        this.setInternalProperty('daemonizeWorker', false)//取消子进程守护
        if (this.hasInternalProperty('CServer')) await new Promise<void>(resolve => this.getInternalProperty<Server>('CServer').close(() => resolve()))
        if (this.hasInternalProperty('worker')) {
            this.getInternalProperty<ChildProcess>('worker').removeAllListeners()
            this.getInternalProperty<ChildProcess>('worker').kill()
        }
        return super.__destroy()
    }
}
