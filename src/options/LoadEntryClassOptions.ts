import {Expect, IndexSignature} from '../decorators/ValidationDecorators'
import {LoadEntryCommonOptions} from './LoadEntryCommonOptions'
import {BaseObject} from '../lib/base/BaseObject'
import {Validator} from '../exports/Validator'
import {IConstructor} from '../interfaces/IConstructor'

@IndexSignature(Validator.Any())
export class LoadEntryClassOptions<T extends BaseObject, U = IConstructor<T>> extends LoadEntryCommonOptions {

    /**
     * 对象元素的构造函数
     */
    @Expect(Validator.Class(() => BaseObject).required())
    public declare readonly class: U

}
