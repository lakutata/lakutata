import {Module} from '../lib/base/Module.js'
import {DTO} from '../lib/base/DTO.js'
import {IConstructor} from '../interfaces/IConstructor.js'
import {Accept} from '../decorators/ValidationDecorators.js'
import {Validator} from '../Validator.js'

export class LoadModuleOptions<T extends Module, U = IConstructor<T>> extends DTO {

    /**
     * 模块的构造函数
     */
    @Accept(Validator.Class(() => Module).required())
    public declare readonly class: U

    /**
     * 需要传入的参数
     */
    @Accept(Validator.Object().pattern(Validator.String(), Validator.Any()).optional().default({}))
    public declare readonly config?: Record<string, any>
}
