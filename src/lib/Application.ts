import {Accept, Return} from '../decorators/MethodDecorators.js'
import {Validator} from '../Validator.js'
import {IApplicationOptions} from '../interfaces/IApplicationOptions.js'

export class Application {
    //todo

    constructor(options: IApplicationOptions) {
        // process.nextTick()
    }

    @Accept(Validator.Object({
        a: Validator.String().required().valid('1', '2', '3'),
        cc: Validator.String().optional().default('bbbbbb')
    }), {stripUnknown: true})
    @Return(Validator.Object({test: Validator.String().required()}))
    public async test(obj, bb, cc) {
        console.log('obj:', obj, bb, cc)
        return {test: '123', bbc: 123}
    }

    public test2(opt) {
        console.log(opt)
    }
}
