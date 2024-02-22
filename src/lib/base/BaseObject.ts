import {AsyncConstructor} from './async-constructor/AsyncConstructor.js'
import {Injectable} from '../../decorators/di/Injectable.js'
import {Configurable} from '../../decorators/di/Configurable.js'
import {Transient} from '../../decorators/di/Lifetime.js'
import {
    GetObjectConfigurablePropertiesByConstructor, GetObjectConfigurablePropertiesByPrototype
} from './internal/ObjectConfigure.js'

@Transient()
@Injectable()
export class BaseObject extends AsyncConstructor {
    constructor() {
        super(async (): Promise<void> => {
            //todo
        })
    }

    ggg() {
    }
}

@Injectable()
class XX extends BaseObject {
    @Configurable()
    public xxx: string

    ggg() {
    }

    public static xxyx: string = '111'
}

class XX1 extends XX {
    @Configurable()
    public xxx1: string

    ggg() {
    }

    public static xxyx1: string = '111'
}

console.log(await new XX())
console.log('XX', GetObjectConfigurablePropertiesByPrototype(XX.prototype))
console.log('XX1', GetObjectConfigurablePropertiesByPrototype(XX1.prototype))
