import {DTO} from '../lib/base/DTO'
import {BaseObject} from '../lib/base/BaseObject'
import {Expect} from '../decorators/ValidationDecorators'
import {Validator} from '../exports/Validator'
import {LoadEntryClassOptions} from './LoadEntryClassOptions'
import {LoadEntryCommonOptions} from './LoadEntryCommonOptions'
import {IConstructor} from '../interfaces/IConstructor'
import {AsyncFunction} from '../types/AsyncFunction'
import {Module} from '../lib/base/Module'
import {LoadModuleOptions} from './LoadModuleOptions'
import {Component} from '../lib/base/Component'
import {LoadComponentOptions} from './LoadComponentOptions'
import {Controller} from '../lib/base/Controller'

export class ModuleOptions<U extends Module, T extends BaseObject = BaseObject> extends DTO {
    /**
     * 模块依赖注入对象配置
     */
    @Expect(Validator
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
    public declare readonly entries?: Record<string, LoadEntryCommonOptions | LoadEntryClassOptions<T>>

    /**
     * 自动对象加载配置
     */
    @Expect(Validator.Array(
            Validator
                .Alternatives()
                .try(
                    Validator.Glob(),
                    Validator.Class(BaseObject)
                )
        )
            .optional()
            .default([])
    )
    public declare readonly autoload?: (string | IConstructor<T>)[]

    /**
     * 控制器加载配置
     */
    @Expect(Validator.Array(
            Validator
                .Alternatives()
                .try(
                    Validator.Glob(),
                    Validator.Class(Controller)
                )
        )
            .optional()
            .default([])
    )
    public declare readonly controllers?: (string | IConstructor<Controller>)[]

    /**
     * 组件注入配置
     */
    @Expect(Validator
        .Object()
        .pattern(Validator.String(),
            Validator.Alternatives().try(
                Validator.Class(Component),
                LoadComponentOptions.schema()
            )
        ).optional()
        .default({}))
    public declare readonly components?: Record<string, IConstructor<Component> | LoadComponentOptions<Component>>

    /**
     * 子模块注入配置
     */
    @Expect(Validator
        .Object()
        .pattern(Validator.String(),
            Validator.Alternatives().try(
                Validator.Class(Module),
                LoadModuleOptions.schema()
            )
        ).optional()
        .default({}))
    public declare readonly modules?: Record<string, IConstructor<Module> | LoadModuleOptions<Module>>

    /**
     * 模块引导启动组件
     */
    @Expect(Validator.Array(
        Validator.Alternatives().try(
            Validator.String(),
            Validator.Class(BaseObject),
            Validator.AsyncFunction()
        )
    )
        .optional()
        .default([]))
    public declare readonly bootstrap?: (string | IConstructor<T> | AsyncFunction<U, void>)[]
}
