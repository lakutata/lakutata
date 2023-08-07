import {Module} from '../lib/base/Module.js'
import {DTO} from '../lib/base/DTO.js'
import {IConstructor} from '../interfaces/IConstructor.js'
import {Accept} from '../decorators/ValidationDecorators.js'
import {Validator} from '../Validator.js'

export class LoadModuleOptions<T extends Module, U = IConstructor<T>> extends DTO {

    @Accept(Validator.Class(() => Module).required())
    public readonly class: U

    [props: string]: any
}
