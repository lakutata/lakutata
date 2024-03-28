import {BaseObject} from '../base/BaseObject.js'
import {Scoped} from '../../decorators/di/Lifetime.js'
import {DefineObjectType, ObjectType} from '../base/internal/ObjectType.js'

/**
 * Provider base class
 */
@Scoped()
@DefineObjectType(ObjectType.Provider)
export class Provider extends BaseObject {

    /**
     * Get environment variable
     * @param name
     * @protected
     */
    protected getEnv(name: string): string | undefined
    /**
     * Get environment variable
     * @param name
     * @param defaultValue
     * @protected
     */
    protected getEnv(name: string, defaultValue: string): string
    protected getEnv(name: string, defaultValue?: string): string | undefined {
        const value: string | undefined = process.env[name]
        return (value === undefined && defaultValue !== undefined) ? defaultValue : value
    }

}
