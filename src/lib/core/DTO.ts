import {DataValidator, DefaultValidationOptions} from '../base/internal/DataValidator.js'
import {ValidationOptions} from 'joi'

export class DTO extends DataValidator {

    #props: Record<string, any>

    #validateOptions: ValidationOptions

    constructor(props: Record<string, any> = {}, validateOptions: ValidationOptions = DefaultValidationOptions, async: boolean = false) {
        super()
        this.#props = props
        this.#validateOptions = validateOptions
        //TODO
    }

    #fff() {
    }
}
