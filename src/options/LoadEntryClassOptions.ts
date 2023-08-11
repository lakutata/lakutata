import {Accept} from '../decorators/ValidationDecorators.js'
import {LoadEntryCommonOptions} from './LoadEntryCommonOptions.js'
import {BaseObject} from '../lib/base/BaseObject.js'
import {Validator} from '../Validator.js'
import {IConstructor} from '../interfaces/IConstructor.js'

export class LoadEntryClassOptions<T extends BaseObject, U = IConstructor<T>> extends LoadEntryCommonOptions {

    /**
     * 对象元素的构造函数
     */
    @Accept(Validator.Class(() => BaseObject).required())
    public declare readonly class: U

}
