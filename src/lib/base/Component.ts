import {BaseObject} from './BaseObject.js'
import {EventEmitter} from 'events'
import {InjectionProperties} from '../../types/InjectionProperties.js'
import {InjectModule, Lifetime} from '../../decorators/DependencyInjectionDecorators.js'
import {Logger} from '../components/Logger.js'
import {Module} from './Module.js'

/**
 * 组件基类
 */
@Lifetime('SINGLETON', false)
export class Component extends BaseObject implements EventEmitter {

    /**
     * 组件所在的模块对象
     * @protected
     */
    @InjectModule()
    protected readonly module: Module

    /**
     * 定义log组件，若容器内有log组件则对其进行注入
     * @protected
     */
    protected readonly log: Logger

    /**
     * Constructor
     * @param properties
     */
    constructor(properties: InjectionProperties = {}) {
        super(properties)
        this.setInternalProperty('type', 'Component')
        this.setInternalProperty('eventEmitter', new EventEmitter())
    }

    /**
     * Internal init function
     * @protected
     */
    protected async __init(): Promise<void> {
        this.setProperty('log', await this.module.get('log'))
    }

    /**
     * Internal destroy function
     * @protected
     */
    protected async __destroy(): Promise<void> {
        this.getInternalProperty<EventEmitter>('eventEmitter').removeAllListeners()
        return super.__destroy()
    }

    /**
     * 组件销毁函数
     * @protected
     */
    protected async destroy(): Promise<void> {
        //在子类中覆写
    }

    /**
     * emitter.on(eventName, listener)的别名
     * @param eventName
     * @param listener
     */
    public addListener(eventName: string | symbol, listener: (...args: any[]) => void): this {
        this.getInternalProperty<EventEmitter>('eventEmitter').addListener(eventName, listener)
        return this
    }

    /**
     * 以注册顺序同步调用为事件eventName注册的每个监听器，将提供的参数传递给每个监听器
     * @param eventName
     * @param args
     */
    public emit(eventName: string | symbol, ...args: any[]): boolean {
        return this.getInternalProperty<EventEmitter>('eventEmitter').emit(eventName, ...args)
    }

    /**
     * 返回一个列出发射器已注册监听器的事件的数组。数组中的值是字符串或符号
     */
    public eventNames(): Array<string | symbol> {
        return this.getInternalProperty<EventEmitter>('eventEmitter').eventNames()
    }

    /**
     * 返回当前最大监听器值
     */
    public getMaxListeners(): number {
        return this.getInternalProperty<EventEmitter>('eventEmitter').getMaxListeners()
    }

    /**
     * 返回监听事件eventName的监听器数量
     * 如果提供了监听器参数，它将返回监听器在事件的监听器列表中出现的次数
     * @param eventName
     * @param listener
     */
    public listenerCount(eventName: string | symbol, listener?: Function): number {
        return this.getInternalProperty<EventEmitter>('eventEmitter').listenerCount(eventName, listener)
    }

    /**
     * 返回事件eventName的监听器数组的副本
     * @param eventName
     */
    public listeners(eventName: string | symbol): Function[] {
        return this.getInternalProperty<EventEmitter>('eventEmitter').listeners(eventName)
    }

    /**
     * emitter.removeListener()的别名
     * @param eventName
     * @param listener
     */
    public off(eventName: string | symbol, listener: (...args: any[]) => void): this {
        this.getInternalProperty<EventEmitter>('eventEmitter').off(eventName, listener)
        return this
    }

    /**
     * 将监听器函数添加到事件eventName的监听器数组的末尾
     * 不会检查监听器是否已经被添加，多次调用传递相同的eventName和listener组合将导致监听器被多次添加和调用
     * @param eventName
     * @param listener
     */
    public on(eventName: string | symbol, listener: (...args: any[]) => void): this {
        this.getInternalProperty<EventEmitter>('eventEmitter').on(eventName, listener)
        return this
    }

    /**
     * 为事件eventName添加一个一次性的监听器函数
     * 下次触发eventName时，此监听器将被移除，然后被调用
     * @param eventName
     * @param listener
     */
    public once(eventName: string | symbol, listener: (...args: any[]) => void): this {
        this.getInternalProperty<EventEmitter>('eventEmitter').once(eventName, listener)
        return this
    }

    /**
     * 将监听器函数添加到事件eventName的监听器数组的开头
     * 不会检查监听器是否已经被添加，多次调用传递相同的eventName和listener组合将导致监听器被多次添加和调用
     * @param eventName
     * @param listener
     */
    public prependListener(eventName: string | symbol, listener: (...args: any[]) => void): this {
        this.getInternalProperty<EventEmitter>('eventEmitter').prependListener(eventName, listener)
        return this
    }

    /**
     * 将一个一次性的监听器函数添加到事件eventName的监听器数组的开头
     * 下次触发eventName时，此监听器将被移除，然后被调用
     * @param eventName
     * @param listener
     */
    public prependOnceListener(eventName: string | symbol, listener: (...args: any[]) => void): this {
        this.getInternalProperty<EventEmitter>('eventEmitter').prependOnceListener(eventName, listener)
        return this
    }

    /**
     * 返回事件eventName的监听器数组的副本，包括任何包装器（例如通过.once()创建的包装器）
     * @param eventName
     */
    public rawListeners(eventName: string | symbol): Function[] {
        return this.getInternalProperty<EventEmitter>('eventEmitter').rawListeners(eventName)
    }

    /**
     * 移除所有监听器，或者移除指定事件eventName的监听器
     * @param event
     */
    public removeAllListeners(event?: string | symbol): this {
        this.getInternalProperty<EventEmitter>('eventEmitter').removeAllListeners(event)
        return this
    }

    /**
     * 从事件eventName的监听器数组中移除指定的监听器
     * @param eventName
     * @param listener
     */
    public removeListener(eventName: string | symbol, listener: (...args: any[]) => void): this {
        this.getInternalProperty<EventEmitter>('eventEmitter').removeListener(eventName, listener)
        return this
    }

    /**
     * 默认情况下，如果为特定事件添加的监听器超过10个则将打印警告。这是一个有用的默认设置，有助于发现内存泄漏
     * setMaxListeners()方法允许为特定的EventEmitter实例修改限制，该值可以设置为Infinity（或0）以表示无限数量的监听器
     * @param n
     */
    public setMaxListeners(n: number): this {
        this.getInternalProperty<EventEmitter>('eventEmitter').setMaxListeners(n)
        return this
    }
}
