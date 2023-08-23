import {Cron} from '../../lib/base/abstracts/Cron'

export class TestCron extends Cron {
    protected async executor(): Promise<void> {
        console.log('this is cron executor')
    }
}
