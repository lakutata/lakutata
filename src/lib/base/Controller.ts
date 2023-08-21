import {Component} from './Component'
import {InjectionProperties} from '../../types/InjectionProperties'
import {InjectApp, Lifetime} from '../../decorators/DependencyInjectionDecorators'
import {Application} from '../Application'
import {IConstructor} from '../../interfaces/IConstructor'
import {CONTROLLER_CONSTRUCTOR_MARK, CONTROLLER_PATTERN_MANAGER} from '../../constants/MetadataKey'
import {Container} from './Container'
import {IPatRun} from '../../interfaces/IPatRun'
import {
    NoMatchedControllerActionPatternException
} from '../../exceptions/controller/NoMatchedControllerActionPatternException'

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
     * Constructor
     * @param properties
     */
    constructor(properties: InjectionProperties = {}) {
        super(properties)
        this.setInternalProperty('type', 'Controller')
    }

    /**
     * 将动作转发至另一个控制器进行处理
     * @param controllerConstructor
     * @param subject
     * @param configurableParams
     */
    public async forward<T extends Controller>(controllerConstructor: IConstructor<T>, subject: Record<string, any>, configurableParams: Record<string, any> = {}): Promise<any> {
        const controllerPatternManager: IPatRun | undefined = Reflect.getOwnMetadata(CONTROLLER_PATTERN_MANAGER, controllerConstructor)
        if (!controllerPatternManager) throw new NoMatchedControllerActionPatternException('The pattern of the controller action does not match the subject passed in the invocation')
        const actionName: string | number | symbol = controllerPatternManager.find(subject)
        if (!actionName) throw new NoMatchedControllerActionPatternException('The pattern of the controller action does not match the subject passed in the invocation')
        const runtimeContainer: Container = this.getInternalProperty('runtimeContainer')
        const instance: T = await runtimeContainer.createObject(controllerConstructor, configurableParams)
        return await instance[actionName](subject)
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
