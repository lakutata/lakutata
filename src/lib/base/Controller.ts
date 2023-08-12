import {Component} from './Component.js'
import {InjectionProperties} from '../../types/InjectionProperties.js'
import {InjectApp, InjectModule, Lifetime} from '../../decorators/DependencyInjectionDecorators.js'
import {Application} from '../Application.js'
import {Module} from './Module.js'

/**
 * 控制器基类
 */
@Lifetime('TRANSIENT', true)
export class Controller extends Component {

    @InjectApp()
    protected readonly app: Application

    @InjectModule()
    protected readonly module: Module

    /**
     * Constructor
     * @param properties
     */
    constructor(properties: InjectionProperties = {}) {
        super(properties)
        this.setInternalProperty('type', 'Controller')
    }

    protected async __init(): Promise<void> {
        return super.__init()
    }

    protected async __destroy(): Promise<void> {
        return super.__destroy()
    }
}
