## Description

Due to the single-threaded asynchronous model of Node.js, processing a large amount of synchronous computation can block
the process. To address this issue, Node.js provides the `worker_threads` module for creating and manipulating worker
threads. In Lakutata, we have encapsulated the handling of worker threads to simplify the complexity of inter-thread
communication. We use [piscina](https://github.com/piscinajs/piscina) to handle thread pool operations and encapsulate
thread operations as `ThreadTask`
class.

However, it is important to note that the main thread and the worker threads in Node.js share the same event loop. If
a `ThreadTask` executes a large amount of work that occupies the event loop, it may cause the program's event loop to
block and result in the program freezing. The most typical example is using `Serialport` to listen for serial port data
events within a `ThreadTask`. This will cause the entire process's event loop to block, leading to a program deadlock
situation.

## How to Use

The following code is an example of using ThreadTask to calculate the Fibonacci sequence in a child thread:

```typescript
import {ThreadTask} from 'lakutata'

export class FibonacciThreadTask extends ThreadTask {
    /**
     * Fibonacci sequence calculation
     * @param n
     * @protected
     */
    protected fib(n: number): number {
        if (n < 2) return n
        return this.fib(n - 1) + this.fib(n - 2)
    }

    /**
     * Thread executor, this method will be invoked when calling the thread to process a task, and parameters will be passed to this method.
     * @param n
     * @protected
     */
    protected async executor(n: number): Promise<number> {
        return this.fib(n)
    }
}

```

After declaring the FibonacciThreadTask class, load the FibonacciThreadTask into the program by declaring it using
dependency injection:

```typescript
import {Applciation, Logger} from 'lakutata'

(async (): Promise<void> => {
    const app: Application = await Application.run({
        entries: {
            fib: {
                class: FibonacciThreadTask,
                //Specify the minimum number of worker threads.
                minThreads: 1,
                //Execute with the maximum number of worker threads.
                maxThreads: os.cpus().length
            }
        }
    })
    const log: Logger = await app.get<Logger>('log')
    const fib: FibonacciThreadTask = await app.get<FibonacciThreadTask>('fib')
    log.info(await fib.run(32))//Output the calculation result of the Fibonacci sequence
})()
```

In addition to directly invoking the processing method of a child thread, ThreadTask also provides the ability for
stream processing. You can create a Transform using the `createStreamHandler` method to process stream data in a child
thread. When combined with a thread pool, this can improve the performance of stream data processing.
