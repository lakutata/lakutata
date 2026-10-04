import {DTO} from '../lib/dto/DTO.js'
import {BaseObject} from '../lib/base/BaseObject.js'
import {Expect} from '../decorators/dto/Expect.js'
import {Module} from '../lib/core/Module.js'
import {ModuleLoadObjectsOptions} from './ModuleLoadObjectsOptions.js'
import {OverridableNamedObjectOptions} from './OverridableNamedObjectOptions.js'
import {Component} from '../lib/core/Component.js'
import {IBaseObjectConstructor} from '../interfaces/IBaseObjectConstructor.js'
import {Provider} from '../lib/core/Provider.js'

export type BootstrapAsyncFunction<T = any, U = any> = (target: T) => Promise<U>

export type BootstrapOption =
    string
    | symbol
    | IBaseObjectConstructor
    | BootstrapAsyncFunction<Module, void>

/**
 * The options of a module (and the base of the application options): the components, providers and objects it
 * declares, and its bootstrap steps. A module gives its own by the initializer of its `options` property; the options
 * configured for it are merged over them.
 * @example
 * ```typescript
 * import {Component, Module, type ModuleOptions, Provider} from 'lakutata'
 *
 * class Inventory extends Component {
 * }
 *
 * class StockQuery extends Provider {
 * }
 *
 * export class StockModule extends Module {
 *     protected options: ModuleOptions = {
 *         components: {
 *             inventory: {class: Inventory, maxListeners: 50}
 *         },
 *         providers: {
 *             stock: {class: StockQuery}
 *         },
 *         bootstrap: [
 *             'inventory',
 *             async (module: Module): Promise<void> => {
 *                 await module.getObject('stock')
 *             }
 *         ]
 *     }
 * }
 * ```
 */
export class ModuleOptions extends DTO {

    /**
     * The components the module declares, by name: their declarations (`{class, ...options}`), the class a
     * {@link Component} subclass. A declaration without class completes the options of the component of the same name
     * declared by the module's initializer or by `Application.preset()`. A class which is not a component fails the
     * module's initialization with an {@link InvalidObjectTypeException}; a declaration without class and without
     * component of its name, with an {@link OverridableObjectTargetConfigNotFoundException}.
     */
    @Expect(OverridableNamedObjectOptions.optional())
    public components?: OverridableNamedObjectOptions<IBaseObjectConstructor<Component>>

    /**
     * The providers the module declares, by name, as the components: the class a {@link Provider} subclass.
     */
    @Expect(OverridableNamedObjectOptions.optional())
    public providers?: OverridableNamedObjectOptions<IBaseObjectConstructor<Provider>>

    /**
     * The other objects the module declares (plain objects, modules), named or anonymous.
     * @default {named: {}, anonymous: []}
     */
    @Expect(
        ModuleLoadObjectsOptions
            .optional()
            .default({
                named: {},
                anonymous: []
            })
    )
    public objects?: ModuleLoadObjectsOptions

    /**
     * The steps run in order once the module's objects are registered: a name, a symbol or a class is got from the
     * module (creating the object, such as a server starting to listen), an async function is called with the module.
     * A failing step fails the module's initialization (for the application, a fatal exception).
     * @default []
     */
    @Expect(
        DTO.Array(
            DTO.Alternatives(
                DTO.String(),
                DTO.Class(BaseObject),
                DTO.AsyncFunction()
            )
        )
            .optional()
            .default([])
    )
    public bootstrap?: BootstrapOption[]

    /**
     * Check the options of the declared objects when the module initializes, before any of them is created: an
     * invalid value of a configurable property fails the initialization with an
     * {@link InvalidObjectOptionsException}, an option which is not a configurable property is warned of.
     * @default true
     */
    @Expect(DTO.Boolean().optional())
    public checkOptions?: boolean
}
