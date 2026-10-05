import {PropertyDecorator} from '../../types/PropertyDecorator.js'
import {BaseObject} from '../../lib/base/BaseObject.js'
import {
    InjectionName,
    InjectionTransformFunction,
    setObjectInjectItem
} from '../../lib/base/internal/ObjectInjection.js'
import {isClass} from '../../lib/ioc/Utils.js'
import {As} from '@lakutata/utils/As'
import {removeObjectConfigurableProperty} from '../../lib/base/internal/ObjectConfiguration.js'

/**
 * Inject into the property the object registered in the container under the property's name.
 * The injection happens when the object is created, before its `@Configurable` properties are set and before its
 * `init()` runs; it replaces a `@Configurable` declaration of the property in a parent class.
 * @returns The property decorator.
 * @throws {DependencyInjectionException} When the object is created, if the registration cannot be resolved (the creation
 * of the object rejects).
 * @example
 * ```typescript
 * import {Application, Component} from 'lakutata'
 * import {Inject} from 'lakutata/decorator/di'
 *
 * class Mailer extends Component {
 *     public async send(to: string, text: string): Promise<void> {
 *         console.log(to, text)
 *     }
 * }
 *
 * class Signup extends Component {
 *     //The component registered as "mailer"
 *     @Inject()
 *     protected readonly mailer!: Mailer
 *
 *     //The object registered for the class (a class marked with @Autoload is registered on first use)
 *     @Inject(Application)
 *     protected readonly app!: Application
 *
 *     //The component registered as "mailer", transformed: its send function bound to it
 *     @Inject('mailer', (mailer: Mailer) => mailer.send.bind(mailer))
 *     protected readonly send!: (to: string, text: string) => Promise<void>
 *
 *     public async register(email: string): Promise<void> {
 *         await this.mailer.send(email, `Welcome to ${this.app.appName}`)
 *     }
 * }
 *
 * Application.run(() => ({
 *     id: 'signup.app',
 *     name: 'Signup',
 *     components: {
 *         mailer: {class: Mailer},
 *         signup: {class: Signup}
 *     }
 * }))
 * ```
 */
export function Inject<ClassPrototype extends BaseObject>(): PropertyDecorator<ClassPrototype>
/**
 * Inject into the property the object registered in the container under a name, or for a class.
 * The injection happens when the object is created, before its `@Configurable` properties are set and before its
 * `init()` runs; it replaces a `@Configurable` declaration of the property in a parent class.
 * @param name The registration name (a string or a symbol), or a class: the object registered for the class, which is
 * registered on first use when the class is marked with `@Autoload()`.
 * @returns The property decorator.
 * @throws {DependencyInjectionException} When the object is created, if the registration cannot be resolved (the creation
 * of the object rejects).
 */
export function Inject<ClassPrototype extends BaseObject>(name: InjectionName): PropertyDecorator<ClassPrototype>
/**
 * Inject into the property a value derived from the object registered in the container under the property's name.
 * The injection happens when the object is created, before its `@Configurable` properties are set and before its
 * `init()` runs; it replaces a `@Configurable` declaration of the property in a parent class.
 * @param transform A function (not a class) receiving the registered object and returning the value set to the
 * property; it may be async, the property then receives the value it resolves to.
 * @returns The property decorator.
 * @throws {DependencyInjectionException} When the object is created, if the registration cannot be resolved (the creation
 * of the object rejects); an error of `transform` rejects the creation as it is.
 */
export function Inject<ClassPrototype extends BaseObject>(transform: InjectionTransformFunction): PropertyDecorator<ClassPrototype>
/**
 * Inject into the property a value derived from the object registered in the container under a name, or for a class.
 * The injection happens when the object is created, before its `@Configurable` properties are set and before its
 * `init()` runs; it replaces a `@Configurable` declaration of the property in a parent class.
 * @param name The registration name (a string or a symbol), or a class: the object registered for the class, which is
 * registered on first use when the class is marked with `@Autoload()`.
 * @param transform A function receiving the registered object and returning the value set to the property; it may be
 * async, the property then receives the value it resolves to.
 * @returns The property decorator.
 * @throws {DependencyInjectionException} When the object is created, if the registration cannot be resolved (the creation
 * of the object rejects); an error of `transform` rejects the creation as it is.
 */
export function Inject<ClassPrototype extends BaseObject>(name: InjectionName, transform: InjectionTransformFunction): PropertyDecorator<ClassPrototype>
export function Inject<ClassPrototype extends BaseObject>(nameOrTransform?: InjectionName | InjectionTransformFunction, transform?: InjectionTransformFunction): PropertyDecorator<ClassPrototype> {
    return (target: ClassPrototype, propertyKey: string | symbol): void => {
        let injectionName: InjectionName = propertyKey
        let injectionTransform: InjectionTransformFunction = (injection: any): any => injection
        if (nameOrTransform || transform) {
            if (transform) {
                injectionName = As<InjectionName>(nameOrTransform)
                injectionTransform = transform
            } else {
                if (typeof nameOrTransform === 'function') {
                    if (isClass(nameOrTransform)) {
                        injectionName = As<InjectionName>(nameOrTransform)
                    } else {
                        injectionTransform = As<InjectionTransformFunction>(nameOrTransform)
                    }
                } else {
                    injectionName = As<InjectionName>(nameOrTransform)
                }
            }
        }
        //A class is kept as it is: the container resolves it by its constructor symbol, and autoloads it when it is marked so
        setObjectInjectItem(target, propertyKey, injectionName, injectionTransform)
        //The property is injected, not configured: a configurable property of the parents is removed
        removeObjectConfigurableProperty(target, propertyKey)
    }
}
