import {Accept, Return} from './decorators/MethodValidation.js'
import {Validator} from './lib/Validator.js'

export class Application {
    //todo

    constructor() {
        const gg = 1
    }

    @Accept(Validator.Object({
        a: Validator.String().required().valid('1', '2', '3'),
        cc: Validator.String().optional().default('bbbbbb')
    }), {stripUnknown: true})
    @Return(Validator.Object({test: Validator.String().required()}))
    public test(obj, bb, cc) {
        console.log('obj:', obj, bb, cc)
        return {test: '123', bbc: 123}
    }
}
