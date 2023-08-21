import {DTO} from '../lib/base/DTO'
import {IConstructor} from '../interfaces/IConstructor'
import {Expect, IndexSignature} from '../decorators/ValidationDecorators'
import {Validator} from '../exports/Validator'
import {Component} from '../lib/base/Component'

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
