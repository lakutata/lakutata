import {BaseObject} from '../base/BaseObject.js'
import {Scoped} from '../../decorators/di/Lifetime.js'
import {DefineObjectType, ObjectType} from '../base/internal/ObjectType.js'

/**
 * Provider base class
 */
@Scoped()
@DefineObjectType(ObjectType.Provider)
export class Provider extends BaseObject {
    //TODO
}
