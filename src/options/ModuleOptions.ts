import {DTO} from '../lib/core/DTO.js'
import {BaseObject} from '../lib/base/BaseObject.js'
import {Expect} from '../decorators/dto/Expect.js'
import {Module} from '../lib/core/Module.js'
import {LoadObjectOptions} from './LoadObjectOptions.js'

type BootstrapAsyncFunction<T = any, U = any> = (target: T) => Promise<U>

type BootstrapOption<ObjectConstructor extends typeof BaseObject, ModuleInstance extends Module> =
    string
    | symbol
    | ObjectConstructor
    | BootstrapAsyncFunction<ModuleInstance, void>

type LoadObjectsOption =
    LoadObjectOptions
    | typeof BaseObject
    | string

export class ModuleOptions<ObjectConstructor extends typeof BaseObject = typeof BaseObject, ModuleInstance extends Module = Module> extends DTO {

    /**
     * Load objects option
     */
    @Expect(
        DTO.Array(
            DTO.Alternatives(
                LoadObjectOptions.Schema(),
                DTO.Class(BaseObject),
                DTO.Glob())
        )
            .optional()
            .default([])
    )
    public objects?: LoadObjectsOption[]

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
    public bootstrap?: BootstrapOption<ObjectConstructor, ModuleInstance>[]
}
