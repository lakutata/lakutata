import {Provider} from './Provider.js'
import {ObjectType} from '../base/internal/ObjectType.js'
import {Scoped} from '../../decorators/di/Lifetime.js'

/**
 * Controller base class
 */
@Scoped(true)
export class Controller extends Provider {

    public static accessor $objectType: ObjectType = ObjectType.Controller


}
