/**
 * Reject a promise which does not settle in time
 * @param promise
 * @param timeout ms
 * @param message
 */
export async function withTimeout<T>(promise: Promise<T>, timeout: number, message: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    try {
        return await Promise.race([
            promise,
            new Promise<never>((resolve: (value: never) => void, reject: (reason: Error) => void): void => {
                timer = setTimeout((): void => reject(new Error(message)), timeout)
            })
        ])
    } finally {
        clearTimeout(timer)
    }
}
