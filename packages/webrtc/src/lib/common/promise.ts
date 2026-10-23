export class PromiseQueue {
    queue: {
        promise: () => Promise<unknown>
        done: (...args: any[]) => void
        failed: (...args: any[]) => void
    }[] = []
    running = false

    push = <T>(promise: () => Promise<T>) =>
        new Promise<T>((r, f) => {
            this.queue.push({promise, done: r, failed: f})
            if (!this.running) {
                //run() catches the failures of the tasks
                void this.run()
            }
        })

    private async run() {
        const task = this.queue.shift()
        if (task) {
            this.running = true

            try {
                const res = await task.promise()
                task.done(res)
            } catch (error) {
                task.failed(error)
            }

            void this.run()
        } else {
            this.running = false
        }
    }

    cancel() {
        this.queue = []
    }
}

/**
 * Runs a function that may return a promise without waiting for it: a failure, thrown or rejected, goes to onError.
 * For the callbacks of the applications and the tasks started in the background, whose failures must not become
 * unhandled rejections
 */
export function runDetached(fn: () => unknown, onError: (error: unknown) => void): void {
    try {
        const result: unknown = fn()
        if (result instanceof Promise) result.catch(onError)
    } catch (error) {
        onError(error)
    }
}

/**
 * A function for an event or a timer: it runs fn without waiting for it, a failure going to onError
 */
export function detached<A extends unknown[]>(fn: (...args: A) => unknown, onError: (error: unknown) => void): (...args: A) => void {
    //As runDetached, without a closure for each call (an event of each packet)
    return (...args: A): void => {
        try {
            const result: unknown = fn(...args)
            if (result instanceof Promise) result.catch(onError)
        } catch (error) {
            onError(error)
        }
    }
}
