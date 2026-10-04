import type {ChannelActionInfo, ChannelRuntime, EntrypointAdapter} from '../../channel/EntrypointAdapter.js'
import type {MiddlewareDefinition} from '../../lib/Middleware.js'
import {ScheduleContext} from '../../context/ScheduleContext.js'
import {ScheduleChannel} from '../../channel/BuiltinChannels.js'
import {Cron} from '../../lib/schedule/Cron.js'

export type ScheduleEntrypointOptions = {
    /**
     * The adapter name
     */
    name?: string
    /**
     * The middlewares of the runs of this adapter, run after the global middlewares
     */
    middlewares?: MiddlewareDefinition[]
    /**
     * A run failed, it is written to the log of the application by default
     */
    onError?: (error: unknown, action: ChannelActionInfo, context: ScheduleContext) => void | Promise<void>
    /**
     * A run was skipped: the previous run of the action is still in progress (overlap: the action does not overlap), or
     * another instance runs it (exclusive: its lock held)
     */
    onSkip?: (action: ChannelActionInfo, scheduledAt: Date, reason: 'overlap' | 'exclusive') => void
}

/**
 * The locks of the exclusive schedules: a component of the locks (the Mutex of @lakutata/mutex)
 */
type ScheduleLocks = {
    tryAcquire(name: string): Promise<{ release(): Promise<unknown> } | undefined>
}

/**
 * The longest time a lock of a run is kept after it (the other instances whose clocks are late skip it)
 */
const MAX_HOLD: number = 30000

/**
 * The longest delay of a timer
 */
const MAX_DELAY: number = 2 ** 31 - 1

/**
 * The runs of an action
 */
type ActionState = {
    running: number
    runs: number
}

/**
 * The schedule adapter: runs the actions declared with @Schedule once the application launched.
 * Each run has its own request scope and goes through the middlewares; the runs in progress end before the application stops
 * @param options
 */
export function ScheduleEntrypoint(options: ScheduleEntrypointOptions = {}): EntrypointAdapter<ScheduleContext> {
    const timers: Set<NodeJS.Timeout> = new Set()
    let stopped: boolean = false
    //The locks of the runs ended, kept a while: released at once when the adapter stops
    const keptLocks: Map<{ release(): Promise<unknown> }, NodeJS.Timeout> = new Map()

    const releaseKept = (lock: { release(): Promise<unknown> }): void => {
        clearTimeout(keptLocks.get(lock))
        keptLocks.delete(lock)
        lock.release().catch((): undefined => undefined)
    }

    /**
     * Run a function at a time
     * @param at
     * @param run
     */
    const at = (time: number, run: () => void): void => {
        if (stopped) return
        const delay: number = time - Date.now()
        const timer: NodeJS.Timeout = setTimeout((): void => {
            timers.delete(timer)
            //The delays longer than a timer allows are waited in several times
            delay > MAX_DELAY ? at(time, run) : run()
        }, Math.max(0, Math.min(delay, MAX_DELAY)))
        timers.add(timer)
    }

    /**
     * Write a failed run to the log of the application
     * @param runtime
     * @param error
     * @param action
     * @param context
     */
    const report = async (runtime: ChannelRuntime<ScheduleContext>, error: unknown, action: ChannelActionInfo, context: ScheduleContext): Promise<void> => {
        if (options.onError) return await options.onError(error, action, context)
        await log(runtime, error, `The scheduled action ${action.name} (${context.schedule}) failed`)
    }

    /**
     * Write an error to the log of the application
     * @param runtime
     * @param error
     * @param message
     */
    const log = async (runtime: ChannelRuntime<ScheduleContext>, error: unknown, message: string): Promise<void> => {
        try {
            const logger: any = await runtime.getObject('log')
            logger.error(error, message)
        } catch {
            console.error(`${message}:`, error)
        }
    }

    return {
        channel: 'schedule',
        definition: ScheduleChannel,
        name: options.name,
        middlewares: options.middlewares,
        start: (runtime: ChannelRuntime<ScheduleContext>): void => {
            const states: Map<ChannelActionInfo, ActionState> = new Map()
            //The components of the locks of the exclusive actions
            const locks: Map<ChannelActionInfo, ScheduleLocks> = new Map()

            /**
             * The time between a run of an action and its next one
             * @param action
             * @param scheduledAt
             */
            const period = (action: ChannelActionInfo, scheduledAt: number): number => {
                if (action.address.every !== undefined) return action.address.every
                const next: Date | undefined = new Cron(action.address.cron, action.address.timezone).next(scheduledAt)
                return next ? next.getTime() - scheduledAt : MAX_HOLD * 2
            }

            /**
             * Run an action
             * @param action
             * @param scheduledAt
             */
            const fire = (action: ChannelActionInfo, scheduledAt: number): void => {
                if (stopped) return
                const state: ActionState = states.get(action)!
                if (state.running && !action.address.overlap) return options.onSkip?.(action, new Date(scheduledAt), 'overlap')
                state.running++
                const exclusive: ScheduleLocks | undefined = locks.get(action)
                void (async (): Promise<void> => {
                    let lock: { release(): Promise<unknown> } | undefined
                    try {
                        if (exclusive) {
                            lock = await exclusive.tryAcquire(`schedule:${action.address.exclusiveKey ?? action.name}`)
                            //Run by another instance
                            if (!lock) return options.onSkip?.(action, new Date(scheduledAt), 'exclusive')
                        }
                        state.runs++
                        const context: ScheduleContext = new ScheduleContext({schedule: action.address.schedule, scheduledAt: new Date(scheduledAt), run: state.runs, data: {}})
                        await runtime.dispatchTo(action, context).catch((error: unknown): Promise<void> => report(runtime, error, action, context))
                    } catch (error: unknown) {
                        await log(runtime, error, `The lock of the scheduled action ${action.name} failed`)
                    } finally {
                        state.running--
                        if (lock) {
                            //Kept until the half of its period (30 s at most): the instances whose clocks are late skip
                            //the run too
                            const held: { release(): Promise<unknown> } = lock
                            const remaining: number = scheduledAt + Math.min(period(action, scheduledAt) / 2, MAX_HOLD) - Date.now()
                            if (remaining <= 0 || stopped) {
                                held.release().catch((): undefined => undefined)
                            } else {
                                const timer: NodeJS.Timeout = setTimeout((): void => releaseKept(held), remaining)
                                keptLocks.set(held, timer)
                            }
                        }
                    }
                })().catch((): undefined => undefined)
            }

            /**
             * Plan the runs of an action
             * @param action
             */
            const plan = (action: ChannelActionInfo): void => {
                if (action.address.every !== undefined) {
                    const interval: number = action.address.every
                    //The exclusive ones aligned on the multiples of their interval: the same times in every instance
                    let next: number = action.address.exclusive ? Math.ceil((Date.now() + 1) / interval) * interval : Date.now() + interval
                    const tick = (): void => {
                        fire(action, next)
                        //The runs keep their pace: the times missed (the process was suspended) are skipped
                        next += interval
                        const now: number = Date.now()
                        if (next <= now) next += Math.ceil((now - next + 1) / interval) * interval
                        at(next, tick)
                    }
                    at(next, tick)
                } else {
                    const cron: Cron = new Cron(action.address.cron, action.address.timezone)
                    const schedule = (after: number): void => {
                        const time: Date | undefined = cron.next(after)
                        if (!time) return
                        at(time.getTime(), (): void => {
                            fire(action, time.getTime())
                            schedule(Math.max(Date.now(), time.getTime()))
                        })
                    }
                    schedule(Date.now())
                }
            }

            //The runs begin once the application launched: its objects and the other adapters are ready
            //Only resolved, fire() reports the errors of the runs
            void runtime.ready.then(async (): Promise<void> => {
                if (stopped) return
                for (const action of runtime.actions) {
                    if (action.address.exclusive) {
                        //Its locks: without them, it does not run (rather than in every instance)
                        try {
                            const component: any = await runtime.getObject(action.address.exclusive)
                            if (typeof component?.tryAcquire !== 'function') throw new Error(`The object ${action.address.exclusive} is not a component of the locks (the Mutex of @lakutata/mutex)`)
                            locks.set(action, component)
                        } catch (error: unknown) {
                            await log(runtime, error, `The exclusive scheduled action ${action.name} does not run: its component of the locks ${action.address.exclusive} is not there`)
                            continue
                        }
                    }
                    if (stopped) return
                    states.set(action, {running: 0, runs: 0})
                    if (action.address.immediate) fire(action, Date.now())
                    plan(action)
                }
            })
        },
        stop: (): void => {
            //No new run, the runs in progress are waited for by the entrypoint
            stopped = true
            timers.forEach((timer: NodeJS.Timeout): void => clearTimeout(timer))
            timers.clear()
            //The other instances run the next runs
            ;[...keptLocks.keys()].forEach(releaseKept)
        }
    }
}
