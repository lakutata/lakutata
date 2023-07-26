import {Accept} from './decorators/MethodValidation.js'
import {Validator} from './lib/Validator.js'

export class Application {
    //todo


    constructor() {
        const gg = 1
    }

    @Accept(Validator.Object({
        a: Validator.String().required(),
        cc: Validator.String().optional().default('bbbbbb')
    }), {stripUnknown: true})
    public test(obj, bb, cc) {
        console.log('obj:', obj, bb, cc)
    }
}
