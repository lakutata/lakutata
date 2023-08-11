import {Module} from '../lib/base/Module.js'
import {DTO} from '../lib/base/DTO.js'
import {IConstructor} from '../interfaces/IConstructor.js'
import {Expect, IndexSignature} from '../decorators/ValidationDecorators.js'
import {Validator} from '../Validator.js'

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
