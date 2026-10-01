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

export class ModuleOptions extends DTO {

    /**
     * Load components option
     */
    @Expect(OverridableNamedObjectOptions.optional())
    public components?: OverridableNamedObjectOptions<IBaseObjectConstructor<Component>>

    /**
     * Load providers option
     */
    @Expect(OverridableNamedObjectOptions.optional())
    public providers?: OverridableNamedObjectOptions<IBaseObjectConstructor<Provider>>

    /**
     * Load objects option
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
     * Bootstrap option
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
     * Check the options of the declared objects when the module initializes, before any of them is created (default
     * true): an invalid value of a configurable property fails the initialization, an option which is not a
     * configurable property is warned of
     */
    @Expect(DTO.Boolean().optional())
    public checkOptions?: boolean
}
