import {ThreadTask} from '../../lib/base/abstracts/ThreadTask'

export class TestThreadTask extends ThreadTask {
    protected async executor(workData: Record<string, any>): Promise<any> {
        return 'gg'
    }
}
