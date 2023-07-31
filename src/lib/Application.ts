import {EventEmitter} from 'events'
import {ApplicationOptions} from '../options/ApplicationOptions.js'
import {Validator} from '../Validator.js'
import {Accept, Return} from '../decorators/ValidationDecorators.js'

export class Application extends EventEmitter {

    constructor(options: ApplicationOptions) {
        super()
        this.boot(options)
    }

    @Accept(ApplicationOptions)
    protected boot(options: ApplicationOptions): void {
        //todo
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
