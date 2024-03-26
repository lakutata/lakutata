import {__init, BaseObject} from '../base/BaseObject.js'
import {Scoped} from '../../decorators/di/Lifetime.js'
import {DefineObjectType, ObjectType} from '../base/internal/ObjectType.js'
import {type Application} from './Application.js'
import {As} from '../functions/As.js'
import {type Module} from './Module.js'

/**
 * Provider base class
 */
@Scoped()
@DefineObjectType(ObjectType.Provider)
export class Provider extends BaseObject {

    /**
     * Application getter
     * @protected
     */
    protected get app(): Application {
        let module: Module = this.getModule()
        while (Reflect.getOwnMetadata(__init, module, __init) !== module) module = module.getModule()
        return As(module)
    }

}
