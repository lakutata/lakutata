import {Module} from '../lib/base/Module'
import {DTO} from '../lib/base/DTO'
import {IConstructor} from '../interfaces/IConstructor'
import {Expect, IndexSignature} from '../decorators/ValidationDecorators'
import {Validator} from '../exports/Validator'

@IndexSignature(Validator.Any())
export class LoadModuleOptions<T extends Module, U = IConstructor<T>> extends DTO {

    /**
     * 模块的构造函数
     */
    @Expect(Validator.Class(() => Module).required())
    public declare readonly class: U

    /**
     * 需要传入的参数以索引签名的形式声明
     */
    [key: string]: any
}
