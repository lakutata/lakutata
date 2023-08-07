import {DTO} from '../lib/base/DTO.js'
import {BaseObject} from '../lib/base/BaseObject.js'
import {Accept} from '../decorators/ValidationDecorators.js'
import {Validator} from '../Validator.js'
import {LoadEntryClassOptions} from './LoadEntryClassOptions.js'
import {LoadEntryCommonOptions} from './LoadEntryCommonOptions.js'
import {IConstructor} from '../interfaces/IConstructor.js'
import {AsyncFunction} from '../types/AsyncFunction.js'
import {Module} from '../lib/base/Module.js'
import {LoadModuleOptions} from './LoadModuleOptions.js'

export class ModuleOptions<U extends Module, T extends BaseObject = BaseObject> extends DTO {
    /**
     * 模块依赖注入对象配置
     */
    @Accept(Validator
        .Object()
        .pattern(
            Validator.String(),
            Validator.Alternatives().try(
                LoadEntryClassOptions.schema(),
                LoadEntryCommonOptions.schema()
            )
        )
        .optional()
        .default({}))
    public readonly entries: Record<string, LoadEntryCommonOptions | LoadEntryClassOptions<T>>

    /**
     * 子模块注入配置
     */
    @Accept(Validator
        .Object()
        .pattern(Validator.String(),
            Validator.Alternatives().try(
                Validator.Class(Module),
                LoadModuleOptions.schema()
            )
        ).optional()
        .default({}))
    public readonly modules?: Record<string, IConstructor<Module> | LoadModuleOptions<Module>>

    /**
     * 模块引导启动组件
     */
    @Accept(Validator.Array(
        Validator.Alternatives().try(
            Validator.String(),
            Validator.Class(BaseObject),
            Validator.AsyncFunction()
        )
    ))
    public readonly bootstrap: (string | IConstructor<T> | AsyncFunction<U, void>)[]
}
