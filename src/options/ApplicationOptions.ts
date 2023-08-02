import {DTO} from '../lib/base/DTO.js'
import {Accept} from '../decorators/ValidationDecorators.js'
import {Validator} from '../Validator.js'

export class ApplicationOptions extends DTO {

    @Accept(Validator.String().required())
    readonly id: string

    @Accept(Validator.String().required())
    readonly name: string

    @Accept(Validator.String().optional())
    readonly timezone?: string

    @Accept(Validator.Array().optional().default([]))
    readonly entries: any[] = []
}
