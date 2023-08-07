import {Accept} from '../decorators/ValidationDecorators.js'
import {LoadEntryCommonOptions} from './LoadEntryCommonOptions.js'
import {BaseObject} from '../lib/base/BaseObject.js'
import {Validator} from '../Validator.js'
import {IConstructor} from '../interfaces/IConstructor.js'

export class LoadEntryClassOptions<T extends BaseObject, U = IConstructor<T>> extends LoadEntryCommonOptions {

    @Accept(Validator.Class(BaseObject).required())
    public readonly class: U

}
