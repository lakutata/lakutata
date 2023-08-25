import {ThreadTask} from '../../lib/base/abstracts/ThreadTask'

export class TestThreadTask extends ThreadTask {
    protected async executor(workData: any): Promise<any> {
        return 'g<><><><><><><><><><><><><><><><><><><>g' + workData
    }
}
