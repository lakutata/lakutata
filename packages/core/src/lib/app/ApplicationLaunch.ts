import {As} from '@lakutata/utils/helper/As'

/**
 * The application class, declared by the application module (it cannot be imported here without a cycle)
 */
let applicationClass: Function | undefined

/**
 * The applications which have launched
 */
const launched: WeakSet<object> = new WeakSet()

/**
 * The launches waited for, by application
 */
const waiting: WeakMap<object, { promise: Promise<void>, resolve: () => void }> = new WeakMap()

/**
 * Declare the application class
 * @param target
 */
export function DeclareApplicationClass(target: Function): void {
    applicationClass = target
}

/**
 * Mark an application as launched: every object and the bootstrap of the application are ready
 * @param application
 */
export function MarkApplicationLaunched(application: object): void {
    launched.add(application)
    waiting.get(application)?.resolve()
    waiting.delete(application)
}

/**
 * Wait until the application an object belongs to has launched
 * @param object
 * @return undefined when the object does not belong to an application (such as the objects of a bare container)
 */
export function WhenApplicationLaunched(object: object): Promise<void> | undefined {
    let target: any = object
    while (target && !(applicationClass && target instanceof As<any>(applicationClass))) target = target.getParent?.()
    if (!target) return undefined
    if (launched.has(target)) return Promise.resolve()
    let launch: { promise: Promise<void>, resolve: () => void } | undefined = waiting.get(target)
    if (!launch) {
        let resolve: () => void = (): void => undefined
        const promise: Promise<void> = new Promise((resolver: () => void): void => {
            resolve = resolver
        })
        launch = {promise: promise, resolve: resolve}
        waiting.set(target, launch)
    }
    return launch.promise
}
