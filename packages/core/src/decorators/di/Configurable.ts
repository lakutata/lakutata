import {PropertyDecorator} from '../../types/PropertyDecorator.js'
import {BaseObject} from '../../lib/base/BaseObject.js'
import {SetObjectConfigurableProperty} from '../../lib/base/internal/ObjectConfiguration.js'
import {DTO} from '../../lib/dto/DTO.js'
import {Schema} from '../../lib/validation/types/Schema.js'
import {RemoveObjectInjectItem} from '../../lib/base/internal/ObjectInjection.js'

/**
 * Make the property an option of the object: its value is the option given in the object's declaration (`{class:
 * MyComponent, port: 80}`) or to `getObject()`, else the property's initializer, else the default of its schema. The
 * value is validated against the schema, then passed to `fn`, when the object is created: after its injections, before
 * its `init()` runs. The declaration replaces an `@Inject` or `@Configurable` declaration of the property in a parent
 * class. A module also checks the options of the objects it declares when it initializes, before creating them.
 * @param schema The schema validating the value (it may convert it or give its default). Default `DTO.Any()`: any
 * value, `undefined` included.
 * @param fn A function called with the instance as `this` and the validated value, returning the value set to the
 * property, of the same type (it may be async). Default: the validated value as it is.
 * @returns The property decorator.
 * @throws {InvalidObjectOptionsException} When a module initializes, if an option it declares for the object does not
 * match the schema (all the invalid options are listed).
 * @throws {InvalidValueException} When the object is created, if its value does not match the schema (the creation of
 * the object rejects).
 * @example
 * ```typescript
 * import {Application, Component, DTO} from 'lakutata'
 * import {Configurable} from 'lakutata/decorator/di'
 *
 * class Server extends Component {
 *     //80 unless the declaration gives a port
 *     @Configurable(DTO.Number().integer().min(1).max(65535).optional().default(80))
 *     protected readonly port!: number
 *
 *     //The initializer is the default, validated like a configured value
 *     @Configurable(DTO.String().required())
 *     protected readonly host: string = '127.0.0.1'
 *
 *     //The base URL is kept without its trailing slash
 *     @Configurable(DTO.String().uri().optional().default('http://localhost'), (value: string): string => value.replace(/\/+$/, ''))
 *     protected readonly baseURL!: string
 *
 *     protected async init(): Promise<void> {
 *         console.log(`Listening on ${this.host}:${this.port} for ${this.baseURL}`)
 *     }
 * }
 *
 * Application.run(() => ({
 *     id: 'server.app',
 *     name: 'Server',
 *     components: {
 *         server: {class: Server, port: 8080, baseURL: 'https://example.com/'}
 *     }
 * }))
 * ```
 */
export function Configurable<ClassPrototype extends BaseObject, DataType>(schema: Schema<DataType> = DTO.Any(), fn?: (this: ClassPrototype, value: DataType) => DataType | Promise<DataType>): PropertyDecorator<ClassPrototype> {
    return (target: ClassPrototype, propertyKey: string | symbol): void => {
        SetObjectConfigurableProperty(target, propertyKey, schema, fn)
        //The property is configured, not injected: an injection of the parents is removed
        RemoveObjectInjectItem(target, propertyKey)
    }
}
