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

    /**
     * Return class's name
     */
    public static get className(): string {
        return this.name
    }

    /**
     * Get instance's class name
     */
    public get className(): string {
        return this.constructor.name
    }

    /**
     * Internal initialize function
     * @protected
     */
    protected async __init(): Promise<void> {
        //To be override in child class
    }

    /**
     * Internal destroy function
     * @protected
     */
    protected async __destroy(): Promise<void> {
        //To be override in child class
    }

    /**
     * Initialize function
     * @protected
     */
    protected async init(): Promise<void> {
        //To be override in child class
    }

    /**
     * Destroy function
     * @protected
     */
    protected async destroy(): Promise<void> {
        //To be override in child class
    }
}
