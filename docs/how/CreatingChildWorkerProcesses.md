## Description

When building backend applications or certain desktop applications, Node.js's single-threaded and asynchronous nature
may not fully utilize multicore CPUs. Although Node.js provides the Cluster mode for creating a cluster of processes,
it is more suitable for scenarios involving handling HTTP requests. It may not be well-suited for other scenarios that
require accessing computer resources that cannot be shared among multiple processes, such as using hardware serial
ports. Additionally, the `child_process` module in Node.js can be cumbersome when creating child processes, and manual
handling of communication is required between the parent and child processes.

In the Lakutata framework, child processes are encapsulated and abstracted into a class object that inherits from
Component. It can be used similarly to other injectable objects. Communication between the parent and child processes is
simplified by using Proxy.

## How to Use

```typescript
import {Process, Configurable} from 'lakutata'

class ExampleProcess extends Process {

    /**
     * Just like other dependency injection items, properties marked with `@Configurable()` can receive parameters during initialization. However, for the `Process` class, the passed parameters will be transferred to the child process.
     */
    @Configurable()
    public prop: any

    protected async init(): Promise<void> {
        /**
         * The `init` function will be called when the child process is started.
         */
    }

    protected async destroy(): Promise<void> {
        /**
         * The `destroy` function will be called when the child process ends.
         */
    }

    public synchronousCallTesting(a: number, b: number): number {
        return a + b
    }

    public async asynchronousCallTesting(a: number, b: number): Promise<number> {
        return a + b
    }
}
```

The above code is an example of a Process class. It defines configurable properties and two public methods, one for
synchronous testing and another for asynchronous testing.

```typescript
import {Application, Logger} from 'lakutata'

(async (): Promise<void> => {
    const app = await Application.run({
        /*** Other Options ***/
        entries: {
            proc: {
                class: ExampleProcess,
                prop: '123456'
            }
        }
    })
    const log: Logger = app.get<Logger>('log')
    const proc: ExampleProcess = await app.get<ExampleProcess>('proc')
    log.info(proc.prop)//It will output '123456' at this point.
    proc.prop = 'abcdefg'//Change the property value of a subprocess.
    log.info(proc.prop)//'abcdefg' will be outputted here.
    log.info(proc.synchronousCallTesting(6, 6))//12 will be outputted here.
    log.info(await proc.asynchronousCallTesting(6, 6))//12 will be outputted here.
    app.exit()
})()
```

The above example demonstrates that in the Lakutata framework, the interaction between parent and child processes not
only supports asynchronous method invocation but also supports synchronous method invocation (although this may have
some performance impact, it is generally not recommended to use synchronous method invocation between parent and child
processes). This can simplify the complexity of inter-process communication. However, it is important to note that the
data passed between processes must be supported by the advanced serialization in Node.js's V8 engine. Otherwise, an
error will occur during the communication process.
