import {Validator} from '../Validator.js'
import {IApplicationOptions} from '../interfaces/IApplicationOptions.js'
import {Accept, Return} from '../decorators/ValidationDecorators.js'

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

    @Return(Validator.Object({a: Validator.Number(), b: Validator.String(), c: Validator.Boolean()}))
    public async test2(opt) {
        console.log(opt)
        return {a: 1, b: '1', c: true}
    }
}
