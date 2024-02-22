import {AsyncConstructor} from './async-constructor/AsyncConstructor.js'
import {Injectable} from '../../decorators/di/Injectable.js'
import {Transient} from '../../decorators/di/Lifetime.js'

@Transient()
@Injectable()
export class BaseObject extends AsyncConstructor {
    constructor() {
        super(async (): Promise<void> => {
            //todo
        })
    }
}
