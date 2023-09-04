import {BaseObject, Configurable, Inject, Logger} from '../../Lakutata'
import {FibonacciThreadTask} from '../threads/FibonacciThreadTask'

export class MathObject extends BaseObject {

    @Inject()
    protected readonly log: Logger

    @Inject()
    protected readonly fibonacci: FibonacciThreadTask

    @Configurable()
    protected readonly baseNumber: number

    /**
     * 对象初始化函数
     * @protected
     */
    protected async init(): Promise<void> {
        this.log.info('I\'m Math object, my class name is: %s', this.className)
    }

    /**
     * 加法测试
     * @param a
     * @param b
     */
    public async add(a: number, b: number): Promise<number> {
        const arr: any[] = new Array(this.baseNumber).fill(1).map((value, index) => value + index)
        let total: number = 0
        const fibPromises: Promise<number>[] = []
        arr.forEach(value => fibPromises.push(new Promise((resolve, reject) => this.fibonacci.run(value).then(result=>{
            this.log.info('fib(%s) = %s', value, result)
            total += result
            return resolve(result)
        }).catch(reject))))
        await Promise.all(fibPromises)
        return a + b + total
    }
}
