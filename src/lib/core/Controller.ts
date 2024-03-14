import {Provider} from './Provider.js'
import {DefineObjectType, ObjectType} from '../base/internal/ObjectType.js'
import {Scoped} from '../../decorators/di/Lifetime.js'

export type ControllerProperty<ClassPrototype extends Controller> = Exclude<keyof ClassPrototype, keyof Controller>

/**
 * Controller base class
 */
@Scoped(true)
@DefineObjectType(ObjectType.Controller)
export class Controller extends Provider {

    context: any
}
