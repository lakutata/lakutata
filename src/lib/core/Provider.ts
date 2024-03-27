import {__destroy, __init, BaseObject} from '../base/BaseObject.js'
import {Scoped} from '../../decorators/di/Lifetime.js'
import {DefineObjectType, ObjectType} from '../base/internal/ObjectType.js'
import {Application} from './Application.js'

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
        return Reflect.getOwnMetadata('APP_LINK', this)
    }

    /**
     * Internal initializer
     * @param hooks
     * @protected
     */
    protected async [__init](...hooks: (() => Promise<void>)[]): Promise<void> {
        await super[__init](...hooks, async () => {
            //Inject app into current instance
            Reflect.defineMetadata('APP_LINK', await this.getObject(Application), this)
        })
    }
    //
    // /**
    //  * Internal destroyer
    //  * @param hooks
    //  * @protected
    //  */
    // protected async [__destroy](...hooks: (() => Promise<void>)[]): Promise<void> {
    //     await super[__destroy](...hooks, async (): Promise<void> => {
    //         // Reflect.deleteMetadata(APP_LINK, this)
    //     })
    // }

}
