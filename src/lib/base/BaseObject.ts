import {AsyncConstructor} from './async-constructor/AsyncConstructor.js'
import {Injectable} from '../../decorators/di/Injectable.js'
import {Configurable} from '../../decorators/di/Configurable.js'

@Injectable()
export class BaseObject extends AsyncConstructor {
    constructor() {
        super(async (): Promise<void> => {
            //todo
        })
    }

    ggg(){}
}

class XX extends BaseObject{
    @Configurable()
    public xxx:string

    ggg(){}

    public static xxyx:string='111'
}

// new XX()
