import {DTO} from '../lib/base/DTO.js'
import {IConstructor} from '../interfaces/IConstructor.js'
import {Expect, IndexSignature} from '../decorators/ValidationDecorators.js'
import {Validator} from '../exports/Validator.js'
import {Component} from '../lib/base/Component.js'

@IndexSignature(Validator.Any())
export class LoadComponentOptions<T extends Component, U = IConstructor<T>> extends DTO {

    /**
     * 组件的构造函数
     */
    @Expect(Validator.Class(Component).required())
    public declare readonly class: U

    /**
     * 需要传入的参数以索引签名的形式声明
     */
    [key: string]: any
}
