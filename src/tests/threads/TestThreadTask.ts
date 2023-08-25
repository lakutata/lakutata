import {ThreadTask} from '../../lib/base/abstracts/ThreadTask'

export class TestThreadTask extends ThreadTask {
    protected async executor(workData: any): Promise<any> {
        this.log.info('this is message from sub thread!!!!!!!!!!!!!!!!')
        return 'g<><><><><><><><><><><><><><><><><><><>g' + workData
    }
}
