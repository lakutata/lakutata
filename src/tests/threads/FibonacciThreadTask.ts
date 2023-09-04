import {ThreadTask} from '../../Lakutata'

export class FibonacciThreadTask extends ThreadTask {

    /**
     * 斐波那契数列计算
     * @param n
     * @protected
     */
    protected fib(n: number): number {
        if (n < 2) return n
        return this.fib(n - 1) + this.fib(n - 2)
    }

    /**
     * 执行器
     * @param n
     * @protected
     */
    protected async executor(n: number): Promise<number> {
        return this.fib(n)
    }
}
