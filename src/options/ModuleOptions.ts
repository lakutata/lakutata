import {DTO} from '../lib/core/DTO.js'
import {BaseObject} from '../lib/base/BaseObject.js'
import {Expect} from '../decorators/dto/Expect.js'
import {Module} from '../lib/core/Module.js'
import {ModuleLoadObjectsOptions} from './ModuleLoadObjectsOptions.js'
import {OverridableNamedObjectOptions} from './OverridableNamedObjectOptions.js'
import {Component} from '../lib/core/Component.js'
import {IBaseObjectConstructor} from '../interfaces/IBaseObjectConstructor.js'
import {Provider} from '../lib/core/Provider.js'
import {Controller} from '../lib/core/Controller.js'

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
     * Load modules option
     */
    @Expect(OverridableNamedObjectOptions.optional())
    public modules?: OverridableNamedObjectOptions<IBaseObjectConstructor<Module>>

    /**
     * TODO 控制器应该是一样的，但是同一个action应该可以在cli、api或rpc中被复用
     * @CliAction()
     * @HttpAction()
     * @TcpAction()
     * @RpcAction()
     * @IpcAction()
     */

    /**
     * Load controllers option
     */
    @Expect(DTO.Array(DTO.Class(Controller)).optional().default([]))
    public controllers?: IBaseObjectConstructor<Controller>[]

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
