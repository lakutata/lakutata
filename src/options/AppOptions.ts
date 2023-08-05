import {DTO} from '../lib/base/DTO.js'
import {Accept} from '../decorators/ValidationDecorators.js'
import {Validator} from '../Validator.js'
import {LoadEntryClassOptions} from './LoadEntryClassOptions.js'
import {LoadEntryCommonOptions} from './LoadEntryCommonOptions.js'
import {BaseObject} from '../lib/base/BaseObject.js'
import {IConstructor} from '../interfaces/IConstructor.js'
import {AsyncFunction} from '../types/AsyncFunction.js'
import {App} from '../lib/App.js'

export class AppOptions<T extends BaseObject = BaseObject> extends DTO {

    /**
     * 应用程序ID
     */
    @Accept(Validator.String().required())
    readonly id: string

    /**
     * 应用程序名称
     */
    @Accept(Validator.String().required())
    readonly name: string

    /**
     * 应用程序时区
     */
    @Accept(Validator.String().optional())
    readonly timezone?: string

    /**
     * 应用程序依赖注入对象配置
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
    readonly entries: Record<string, LoadEntryCommonOptions | LoadEntryClassOptions<T>>

    /**
     * 应用程序引导启动组件
     */
    @Accept(Validator.Array(
        Validator.Alternatives().try(
            Validator.String(),
            Validator.Class(BaseObject),
            Validator.AsyncFunction()
        )
    ))
    readonly bootstrap: (string | IConstructor<T> | AsyncFunction<App, void>)[]
}
