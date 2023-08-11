import {DTO} from '../lib/base/DTO.js'
import {IConstructor} from '../interfaces/IConstructor.js'
import {Accept} from '../decorators/ValidationDecorators.js'
import {Validator} from '../Validator.js'
import {Component} from '../lib/base/Component.js'

export class LoadComponentOptions<T extends Component, U = IConstructor<T>> extends DTO {

    /**
     * 组件的构造函数
     */
    @Accept(Validator.Class(Component).required())
    public declare readonly class: U

    /**
     * 需要传入的参数
     */
    @Accept(Validator.Object().pattern(Validator.String(), Validator.Any()).optional().default({}))
    public declare readonly config?: Record<string, any>
}
