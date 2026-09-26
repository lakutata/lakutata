import {Provider} from '../../../lib/core/Provider.js'
import {DefineObjectType, ObjectType} from '../../../lib/base/internal/ObjectType.js'
import {Scoped} from '../../../decorators/di/Lifetime.js'
import {CLIContext} from '../../../lib/context/CLIContext.js'
import {HTTPContext} from '../../../lib/context/HTTPContext.js'
import {ServiceContext} from '../../../lib/context/ServiceContext.js'
import {Configurable} from '../../../decorators/di/Configurable.js'
import {DTO} from '../../../lib/dto/DTO.js'

/**
 * For action decorator
 */
export type ControllerProperty<ClassPrototype extends Controller> = Exclude<keyof ClassPrototype, keyof Controller>

/**
 * Controller base class
 */
@Scoped(true)
@DefineObjectType(ObjectType.Controller)
export class Controller extends Provider {

    /**
     * Context, possible be cli context, http context or service context
     * @protected
     */
    //The context is created (and validated) by the entrypoint, only its type is checked here
    @Configurable(DTO.Alternatives(
        DTO.InstanceOf(CLIContext),
        DTO.InstanceOf(HTTPContext),
        DTO.InstanceOf(ServiceContext)
    ).required())
    protected readonly context: CLIContext | HTTPContext | ServiceContext
}
