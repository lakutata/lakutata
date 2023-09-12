import {Component} from './Component'
import {InjectionProperties} from '../../types/InjectionProperties'
import {Configurable, InjectApp, Lifetime} from '../../decorators/DependencyInjectionDecorators'
import {Application} from '../Application'
import {IConstructor} from '../../interfaces/IConstructor'
import {CONTROLLER_AUTH_MAP, CONTROLLER_CONSTRUCTOR_MARK, CONTROLLER_PATTERN_MANAGER} from '../../constants/MetadataKey'
import {Container} from './Container'
import {IPatRun} from '../../interfaces/IPatRun'
import {
    NoMatchedControllerActionPatternException
} from '../../exceptions/controller/NoMatchedControllerActionPatternException'
import {IUser} from '../../interfaces/IUser'
import {AccessControl} from '../components/access-control/AccessControl'
import {AccessControlConfigureRequiredException} from '../../exceptions/auth/AccessControlConfigureRequiredException'
import {As} from '../../Helper'
import {ControllerAuthConfigItem} from '../../types/ControllerAuthConfigItem'

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

    /**
     * 控制器的运行时容器
     * @protected
     */
    @Configurable()
    protected readonly runtimeContainer: Container

    /**
     * 控制器上下文
     * 该属性在forward的时候会一同传递至子控制器中
     * @protected
     */
    @Configurable()
    protected readonly context: Record<string, any> = {}

    /**
     * 控制器访问用户对象
     * @protected
     */
    @Configurable()
    protected readonly user?: IUser

    protected access: AccessControl

    /**
     * Constructor
     * @param properties
     */
    constructor(properties: InjectionProperties = {}) {
        super(properties)
        this.setInternalProperty('type', 'Controller')
    }

    /**
     * 内部初始化方法
     * @protected
     */
    protected async __init(): Promise<void> {
        await super.__init()
        if (As<Map<IConstructor<any>, Map<string, ControllerAuthConfigItem>> | undefined>(Reflect.getOwnMetadata(CONTROLLER_AUTH_MAP, Application))?.has(this.constructor as IConstructor<any>)) {
            //仅在有权限验证设置的控制器开启accessControl
            this.access = await this.runtimeContainer.get<AccessControl>('access', {user: this.user})
            if (!this.access.configured) throw new AccessControlConfigureRequiredException('Access control is not configured.')
        }
    }

    /**
     * 将动作转发至另一个控制器进行处理
     * @param controllerConstructor
     * @param subject
     * @param configurableParams
     * @protected
     */
    protected async forward<T extends Controller>(controllerConstructor: IConstructor<T>, subject: Record<string, any>, configurableParams: Record<string, any> = {}): Promise<any> {
        const controllerPatternManager: IPatRun | undefined = Reflect.getOwnMetadata(CONTROLLER_PATTERN_MANAGER, controllerConstructor)
        if (!controllerPatternManager) throw new NoMatchedControllerActionPatternException('The pattern of the controller action does not match the subject passed in the invocation')
        const subControllerRuntimeContainer: Container = this.runtimeContainer.createScope()
        const currentControllerConfigurablePropertyNames: string[] = await this.__getConfigurableProperties()
        const currentControllerConfigurableProperties: Record<string, any> = {}
        currentControllerConfigurablePropertyNames.forEach((p: string) => currentControllerConfigurableProperties[p] = this[p])
        await subControllerRuntimeContainer.set(controllerConstructor)
        const func: ((subject: Record<string, any>, params: Record<string, any>) => Promise<any>) | undefined = subControllerRuntimeContainer.controllerPatternManager.find(subject)
        if (!func) throw new NoMatchedControllerActionPatternException('The pattern of the controller action does not match the subject passed in the invocation')
        return await func(subject, Object.assign(configurableParams, Object.assign(currentControllerConfigurableProperties, configurableParams)))
    }

    /**
     * 控制器动作执行前调用方法
     * @param subject
     * @param actionName
     * @protected
     */
    protected async beforeAction(subject: Record<string, any>, actionName: string): Promise<boolean> {
        return true
    }

    /**
     * 控制器动作执行后调用方法
     * @param subject
     * @param actionName
     * @param actionResult
     * @protected
     */
    protected async afterAction(subject: Record<string, any>, actionName: string, actionResult: any): Promise<any> {
        return actionResult
    }

    /**
     * 内部销毁函数
     * @protected
     */
    protected async __destroy(): Promise<void> {
        this.setProperty('context', null)
        return super.__destroy()
    }
}
