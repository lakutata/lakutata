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
    public readonly class: U

    /**
     * 生命周期
     */
    @Accept(Validator.String().valid('SINGLETON', 'TRANSIENT', 'SCOPED').optional().default('SINGLETON'))
    public readonly lifetime?: 'SINGLETON' | 'TRANSIENT' | 'SCOPED'

    /**
     * 需要传入的参数
     */
    @Accept(Validator.Object().pattern(Validator.String(), Validator.Any()).optional().default({}))
    public readonly config?: Record<string, any>
}
