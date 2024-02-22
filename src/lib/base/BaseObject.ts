import {AsyncConstructor} from './async-constructor/AsyncConstructor.js'
import {Injectable} from '../../decorators/di/Injectable.js'
import {Configurable} from '../../decorators/di/Configurable.js'
import {Transient} from '../../decorators/di/Lifetime.js'

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

class XX1 extends BaseObject {
    @Configurable()
    public xxx: string

    ggg() {
    }

    public static xxyx: string = '111'
}

// new XX()
