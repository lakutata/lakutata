import {__init, BaseObject} from '../base/BaseObject.js'
import {Scoped} from '../../decorators/di/Lifetime.js'
import {DefineObjectType, ObjectType} from '../base/internal/ObjectType.js'
import {Application} from './Application.js'
import {As} from '../functions/As.js'
import {type Module} from './Module.js'

const APP_LINK: symbol = Symbol('APP.LINK')

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
        return Reflect.getOwnMetadata(APP_LINK, this)
    }

    /**
     * Internal initializer
     * @param hooks
     * @protected
     */
    protected async [__init](...hooks: (() => Promise<void>)[]): Promise<void> {
        await super[__init](...hooks, async () => {
            //Inject app into current instance
            Reflect.defineMetadata(APP_LINK, await this.getObject(Application), this)
        })
    }

}
