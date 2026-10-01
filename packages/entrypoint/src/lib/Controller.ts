import {Provider, DTO} from '@lakutata/core'
import {Scoped, Configurable} from '@lakutata/core/decorator/di'
import {CLIContext} from '../context/CLIContext.js'
import {HTTPContext} from '../context/HTTPContext.js'
import {ServiceContext} from '../context/ServiceContext.js'
import {BaseContext} from '../context/BaseContext.js'

/**
 * For action decorator
 */
export type ControllerProperty<ClassPrototype extends Controller> = Exclude<keyof ClassPrototype, keyof Controller>

/**
 * Controller base class
 */
@Scoped(true)
export class Controller extends Provider {

    /**
     * Context, possible be cli context, http context or service context
     * @protected
     */
    //The context is created (and validated) by the entrypoint, only its type is checked here: a context of any channel
    @Configurable(DTO.InstanceOf(BaseContext).required())
    protected readonly context: CLIContext | HTTPContext | ServiceContext | BaseContext
}
