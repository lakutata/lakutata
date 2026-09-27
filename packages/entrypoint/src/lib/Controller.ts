import {Provider} from '@lakutata/core'
import {DefineObjectType, ObjectType} from '@lakutata/core/internal'
import {Scoped} from '@lakutata/core/decorator/di'
import {CLIContext} from '../context/CLIContext.js'
import {HTTPContext} from '../context/HTTPContext.js'
import {ServiceContext} from '../context/ServiceContext.js'
import {Configurable} from '@lakutata/core/decorator/di'
import {DTO} from '@lakutata/core'
import {BaseContext} from '../context/BaseContext.js'

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
    //The context is created (and validated) by the entrypoint, only its type is checked here: a context of any channel
    @Configurable(DTO.InstanceOf(BaseContext).required())
    protected readonly context: CLIContext | HTTPContext | ServiceContext | BaseContext
}
