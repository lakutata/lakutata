import {Module} from './Module.js'
import {Singleton} from '../../decorators/di/Lifetime.js'

@Singleton(true)
export class Application extends Module {

    /**
     * Run application
     * @param options
     */
    public static async run(options: any): Promise<void> {
        //TODO 实现该方法
    }

    /**
     * Get application's ID
     */
    public get appId(): string {
        return ''//TODO
    }

    /**
     * Get application's name
     */
    public get appName(): string {
        return ''//TODO
    }

    /**
     * Get application's timezone
     */
    public get timezone(): string {
        return ''//TODO
    }

    /**
     * Get application's uptime
     */
    public get uptime(): number {
        return 0//TODO
    }
}
