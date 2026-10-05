import {BaseObject} from '../base/BaseObject.js'
import {Scoped} from '../../decorators/di/Lifetime.js'
import {DefineObjectType, ObjectType} from '../base/internal/ObjectType.js'

/**
 * The base class of the providers: the functional units living in a scope, such as a request (a repository, a
 * password hasher, a client configured per request). Its lifetime is `@Scoped` by default: one instance per scope (the
 * root container being a scope too). A provider may be declared `@Transient`, or `@Singleton` (one instance shared by
 * the scopes, as in 2.x: a client of a remote service); a long-lived object owning resources (connections,
 * subscriptions, servers) and emitting events is rather a {@link Component}. A singleton provider injecting a scoped
 * object keeps the instance of the scope which created it.
 *
 * Declare it in the `providers` of the application or module options, under a name, with its options; get it with
 * `@Inject` or `getObject()`. It is created on first request, with the async construction of {@link BaseObject}.
 * @example
 * ```typescript
 * import {Application, DTO, Provider} from 'lakutata'
 * import {Configurable} from 'lakutata/decorator/di'
 *
 * export class PriceCalculator extends Provider {
 *     //The tax rate, 0.2 unless configured or set by the TAX_RATE environment variable
 *     @Configurable(DTO.Number().min(0).max(1))
 *     protected readonly taxRate: number = Number(this.getEnv('TAX_RATE', '0.2'))
 *
 *     public withTax(price: number): number {
 *         return price * (1 + this.taxRate)
 *     }
 * }
 *
 * Application.run({
 *     id: 'shop.app',
 *     name: 'Shop',
 *     providers: {
 *         prices: {class: PriceCalculator, taxRate: 0.1}
 *     }
 * })
 * ```
 */
@Scoped()
@DefineObjectType(ObjectType.Provider)
export class Provider extends BaseObject {

    /**
     * Read an environment variable (including the ones set by `Application.env()`).
     * @param name The variable name.
     * @returns The value, or undefined when the variable is not set.
     * @protected
     */
    protected getEnv(name: string): string | undefined
    /**
     * Read an environment variable (including the ones set by `Application.env()`), with a default value.
     * @param name The variable name.
     * @param defaultValue The value returned when the variable is not set.
     * @returns The value, or the default value.
     * @protected
     */
    protected getEnv(name: string, defaultValue: string): string
    protected getEnv(name: string, defaultValue?: string): string | undefined {
        const value: string | undefined = process.env[name]
        return (value === undefined && defaultValue !== undefined) ? defaultValue : value
    }

}
