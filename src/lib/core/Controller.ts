import {Provider} from './Provider.js'
import {DefineObjectType, ObjectType} from '../base/internal/ObjectType.js'
import {Transient} from '../../decorators/di/Lifetime.js'
import {CLIContext} from '../context/CLIContext.js'
import {HTTPContext} from '../context/HTTPContext.js'
import {ServiceContext} from '../context/ServiceContext.js'
import {Configurable} from '../../decorators/di/Configurable.js'
import {DTO} from './DTO.js'

/**
 * For action decorator
 */
export type ControllerProperty<ClassPrototype extends Controller> = Exclude<keyof ClassPrototype, keyof Controller>

/**
 * Controller base class
 */
@Transient(true)
@DefineObjectType(ObjectType.Controller)
export class Controller extends Provider {

    /**
     * Context, possible be cli context, http context or service context
     * @protected
     */
    @Configurable(DTO.Alternatives(CLIContext.Schema(), HTTPContext.Schema(), ServiceContext.Schema()).required())
    protected readonly context: CLIContext | HTTPContext | ServiceContext
}
