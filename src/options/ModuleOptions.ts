import {DTO} from '../lib/core/DTO.js'
import {BaseObject} from '../lib/base/BaseObject.js'
import {Expect} from '../decorators/dto/Expect.js'
import {Module} from '../lib/core/Module.js'
import {ModuleLoadObjectsOptions} from './ModuleLoadObjectsOptions.js'
import {OverridableNamedObjectOptions} from './OverridableNamedObjectOptions.js'

export type BootstrapAsyncFunction<T = any, U = any> = (target: T) => Promise<U>

export type BootstrapOption<ObjectConstructor extends typeof BaseObject = typeof BaseObject, ModuleInstance extends Module = Module> =
    string
    | symbol
    | ObjectConstructor
    | BootstrapAsyncFunction<ModuleInstance, void>

export class ModuleOptions extends DTO {

    /**
     * Load components option
     */
    @Expect(OverridableNamedObjectOptions.optional())
    public components?: OverridableNamedObjectOptions

    /**
     * Load providers option
     */
    @Expect(OverridableNamedObjectOptions.optional())
    public providers?: OverridableNamedObjectOptions

    /**
     * Load modules option
     */
    @Expect(OverridableNamedObjectOptions.optional())
    public modules?: OverridableNamedObjectOptions

    //TODO 还需要加入controllers

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
}
