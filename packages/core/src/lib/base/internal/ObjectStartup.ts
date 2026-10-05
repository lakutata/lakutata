import {AsyncLocalStorage} from 'node:async_hooks'
import {DevNull} from '@lakutata/utils/DevNull'

/**
 * An object starting up (its startup() running): active until its startup ends
 */
type StartupFrame = {
    readonly object: object
    active: boolean
}

/**
 * The objects whose startup the current asynchronous call chain belongs to: the objects they get (directly, or through
 * the objects they create) are given to them without waiting for their own startup
 */
const startupFrames: AsyncLocalStorage<StartupFrame[]> = new AsyncLocalStorage()

/**
 * The startup of an object, and whether it ended
 */
type Startup = {
    readonly promise: Promise<void>
    ended: boolean
}

/**
 * The startup of each object (the last one, for a reloaded object)
 */
const startups: WeakMap<object, Startup> = new WeakMap()

/**
 * Run the startup of an object, after its initialization: the objects getting it wait for its startup, except the
 * call chain of its startup itself, which gets it at once (initialized, not started yet)
 * @param object The object.
 * @param startup Its startup.
 * @returns The startup, its failure handled (it is delivered to the objects getting the object).
 * @internal
 */
export function RunObjectStartup(object: object, startup: () => Promise<void>): Promise<void> {
    const frame: StartupFrame = {object: object, active: true}
    const running: Promise<void> = startupFrames.run([...(startupFrames.getStore() ?? []), frame], async (): Promise<void> => {
        try {
            await startup()
        } finally {
            //The work it began (servers, timers…) keeps the call chain: it no longer skips the wait once started
            frame.active = false
        }
    })
    const record: Startup = {promise: running, ended: false}
    running.catch(DevNull).finally((): unknown => record.ended = true)
    startups.set(object, record)
    return running
}

/**
 * Tell whether the current call chain belongs to the startup of an object
 * @param object The object.
 * @returns true within its startup.
 * @internal
 */
export function IsInObjectStartup(object: object): boolean {
    return !!startupFrames.getStore()?.some((frame: StartupFrame): boolean => frame.active && frame.object === object)
}

/**
 * Wait for the startup of an object given to a requester (at once without startup, or within its startup)
 * @param object The object.
 * @returns Resolves once it started, rejects with the error of its startup.
 * @internal
 */
export async function WaitForObjectStartup(object: object): Promise<void> {
    const startup: Startup | undefined = startups.get(object)
    if (!startup || IsInObjectStartup(object)) return
    await startup.promise
}

/**
 * The end of the startup of an object, its failure ignored (its teardown waits for it): none when it has no startup
 * running, or within its startup, so that its teardown goes on in the same turn
 * @param object The object.
 * @returns Resolves once its startup ended; undefined when there is nothing to wait for.
 * @internal
 */
export function WaitForObjectStartupEnd(object: object): Promise<void> | undefined {
    const startup: Startup | undefined = startups.get(object)
    if (!startup || startup.ended || IsInObjectStartup(object)) return undefined
    return startup.promise.catch(DevNull)
}
