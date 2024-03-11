import {BaseObject} from '../base/BaseObject.js'
import {Scoped} from '../../decorators/di/Lifetime.js'
import {ObjectType} from '../base/internal/ObjectType.js'

/**
 * Provider base class
 */
@Scoped()
export class Provider extends BaseObject {

    public static accessor $objectType: ObjectType = ObjectType.Provider

}
