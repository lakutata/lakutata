import {EventEmitter} from 'events'
import {ApplicationOptions} from '../options/ApplicationOptions.js'
import {Accept, Return} from '../decorators/ValidationDecorators.js'
import {AsyncConstructor} from 'async-constructor'

export class Application extends AsyncConstructor {

    protected aa: number

    constructor(options: ApplicationOptions) {
        super(async (): Promise<void> => {
            await this.boot(options)
            this.aa = 666
        })
    }

    @Accept(ApplicationOptions)
    protected async boot(options: ApplicationOptions): Promise<void> {
        //todo
        console.log('boot')
    }

    public config() {
    }

    public ready() {
        console.log('this.aa', this.aa)
    }
}
