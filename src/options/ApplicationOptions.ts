import {DTO} from '../lib/base/DTO.js'
import {Accept} from '../decorators/ValidationDecorators.js'
import {Validator} from '../Validator.js'

export class ApplicationOptions extends DTO {

    @Accept(Validator.String().required())
    readonly id: string

    @Accept(Validator.String().required())
    readonly name: string

    @Accept(Validator.String().optional().default(process.env.TZ ? process.env.TZ : 'Asia/Shanghai'))
    readonly timezone?: string

}
