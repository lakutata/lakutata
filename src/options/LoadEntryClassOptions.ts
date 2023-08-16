import {Expect, IndexSignature} from '../decorators/ValidationDecorators.js'
import {LoadEntryCommonOptions} from './LoadEntryCommonOptions.js'
import {BaseObject} from '../lib/base/BaseObject.js'
import {Validator} from '../exports/Validator.js'
import {IConstructor} from '../interfaces/IConstructor.js'

@IndexSignature(Validator.Any())
export class LoadEntryClassOptions<T extends BaseObject, U = IConstructor<T>> extends LoadEntryCommonOptions {

    /**
     * 对象元素的构造函数
     */
    @Expect(Validator.Class(() => BaseObject).required())
    public declare readonly class: U

}
