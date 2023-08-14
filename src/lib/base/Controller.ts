import {Component} from './Component.js'
import {InjectionProperties} from '../../types/InjectionProperties.js'
import {InjectApp, InjectModule, Lifetime} from '../../decorators/DependencyInjectionDecorators.js'
import {Application} from '../Application.js'
import {Module} from './Module.js'
import {IConstructor} from '../../interfaces/IConstructor.js'
import {CONTROLLER_CONSTRUCTOR_MARK} from '../../constants/MetadataKey.js'

/**
 * 控制器基类
 */
@(() => {
    return <TFunction extends IConstructor<any>>(target: TFunction): TFunction => {
        Reflect.defineMetadata(CONTROLLER_CONSTRUCTOR_MARK, true, target)
        return target
    }
})()
@Lifetime('SCOPED', true)
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

    /**
     * 控制器动作执行前调用方法
     * @param subject
     * @param actionName
     */
    public async beforeAction(subject: Record<string, any>, actionName: string | symbol | number): Promise<boolean> {
        return true
    }

    /**
     * 控制器动作执行后调用方法
     * @param subject
     * @param actionName
     * @param actionResult
     */
    public async afterAction(subject: Record<string, any>, actionName: string | symbol | number, actionResult: any): Promise<any> {
        return actionResult
    }
}
