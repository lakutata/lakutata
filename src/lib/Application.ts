import {EventEmitter} from 'events'
import {ApplicationOptions} from '../options/ApplicationOptions.js'
import {Accept, Return} from '../decorators/ValidationDecorators.js'

export class Application {

    constructor(options: ApplicationOptions) {

    }

    @Accept(ApplicationOptions)
    protected async boot(options: ApplicationOptions): Promise<void> {
        //todo
        console.log('boot')
    }

    public config(){}

    public ready(){}
}
