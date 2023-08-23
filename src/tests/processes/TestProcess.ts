import {Process} from '../../lib/base/Process'
import {Time} from '../../exports/Time'

export class TestProcess extends Process {

    public testProp: string

    public async sayHi() {
        return 'say HI!'
    }

    public nothing() {

    }

    protected async init(): Promise<void> {
        this.on('test', console.log)
        setTimeout(() => {
            //nothing
            // //测试OOM的情况
            // const arr: any[] = []
            // while (true) {
            //     arr.push(Buffer.alloc(1024 * 1024)) // 每次推送 1MB 的缓冲区
            // }
        }, 3000)
        setInterval(() => {
            // this.emit('test', {text: 'hello', ts: Time.now(), isWorker: this.isWorker()})
            this.log.info('this is child process log from %s', this.className)
        }, 1000)
    }
}
