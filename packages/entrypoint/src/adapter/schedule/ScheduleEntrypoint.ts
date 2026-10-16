import type {ChannelActionInfo, ChannelRuntime, EntrypointAdapter} from '../../channel/EntrypointAdapter.js'
import type {MiddlewareDefinition} from '../../lib/Middleware.js'
import {ScheduleContext} from '../../context/ScheduleContext.js'
import {ScheduleChannel} from '../../channel/BuiltinChannels.js'
import {Cron} from '../../lib/schedule/Cron.js'

/**
 * The options of {@link scheduleEntrypoint}.
 */
export type ScheduleEntrypointOptions = {
    /**
     * The adapter name, to tell apart several schedule adapters of one entrypoint.
     */
    name?: string
    /**
     * The middlewares of this adapter's runs, run after the entrypoint's global middlewares.
     */
    middlewares?: MiddlewareDefinition[]
    /**
     * Called when a run fails (the action, a middleware or the access control threw), with the error, the action and
     * the run's context. A failed run does not stop the next ones.
     * @default the error is written to the application's `log` component (`console.error` without one)
     */
    onError?: (error: unknown, action: ChannelActionInfo, context: ScheduleContext) => void | Promise<void>
    /**
     * Called when a run is skipped, with the action, the time the run was due and why: `'overlap'` when the action's
     * previous run is still in progress (an action without `overlap: true`), `'exclusive'` when another instance of the
     * application holds the run's lock (an `exclusive` action). An error it throws is written to the application's
     * `log` component; the schedule goes on.
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
 * Create the schedule adapter of an entrypoint: it runs the controller actions declared with `@Schedule`, which never
 * run without it. It needs no optional dependency.
 *
 * The runs begin once the application has launched (all its objects, its bootstrap and the other adapters are ready).
 * Each run is dispatched like a request: a new controller in its own scope, the middlewares and the access control, a
 * {@link ScheduleContext} giving the schedule, the time the run was due and its number. An interval keeps its pace:
 * the runs missed while the process was suspended are skipped, not caught up. An action whose previous run is still in
 * progress skips its run unless it allows `overlap`.
 *
 * An `exclusive` action runs in one instance of the application at a time: each run first tries to acquire a lock
 * named `schedule:<key>` (the `key` of its `exclusive` option, the action name by default) from the mutex component
 * (the `Mutex` of `lakutata/com/mutex`, named `mutex` by default), and is skipped when another
 * instance holds it; the lock is kept after the run for half of its period (30 seconds at most) so that the instances
 * whose clocks are late skip it too. An exclusive action whose mutex component cannot be resolved never runs (the
 * error is logged).
 *
 * When the entrypoint stops, no new run starts, the kept locks are released and the entrypoint waits for the runs in
 * progress (aborting them after its `shutdownTimeout`).
 * @param options The adapter options.
 * @returns The adapter, to give to the `schedule` option of `buildEntrypoints`.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints, Controller, ScheduleContext, scheduleEntrypoint} from 'lakutata/com/entrypoint'
 * import {Schedule} from 'lakutata/decorator/ctrl'
 *
 * class MaintenanceController extends Controller {
 *     //Every 5 minutes, and once the application launched
 *     @Schedule({every: '5m', immediate: true})
 *     public async purge(): Promise<void> {
 *         const context: ScheduleContext = this.context as ScheduleContext
 *         console.log(`Run ${context.run}, due at ${context.scheduledAt.toISOString()}`)
 *     }
 *
 *     //Every day at 03:00 in Shanghai
 *     @Schedule({cron: '0 3 * * *', timezone: 'Asia/Shanghai'})
 *     public async report(): Promise<void> {
 *     }
 * }
 *
 * Application.run({
 *     id: 'worker.app',
 *     name: 'Worker',
 *     components: {
 *         entrypoint: buildEntrypoints({
 *             controllers: [MaintenanceController],
 *             schedule: scheduleEntrypoint({
 *                 onError: (error, action): void => console.error(`${action.name} failed`, error),
 *                 onSkip: (action, scheduledAt, reason): void => console.warn(`${action.name} skipped (${reason})`)
 *             })
 *         })
 *     }
 * })
 * ```
 */
export function scheduleEntrypoint(options: ScheduleEntrypointOptions = {}): EntrypointAdapter<ScheduleContext> {
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
     * Give a failed run to the onError handler, or write it to the log of the application; an error of the handler is
     * written to the log
     * @param runtime
     * @param error
     * @param action
     * @param context
     */
    const report = async (runtime: ChannelRuntime<ScheduleContext>, error: unknown, action: ChannelActionInfo, context: ScheduleContext): Promise<void> => {
        if (!options.onError) return await log(runtime, error, `The scheduled action ${action.name} (${context.schedule}) failed`)
        try {
            await options.onError(error, action, context)
        } catch (handlerError: unknown) {
            await log(runtime, handlerError, `The onError handler of the scheduled action ${action.name} failed`)
        }
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
             * Tell a run skipped: an error of the handler is written to the log, the schedule goes on
             * @param action
             * @param scheduledAt
             * @param reason
             */
            const skip = (action: ChannelActionInfo, scheduledAt: number, reason: 'overlap' | 'exclusive'): void => {
                try {
                    options.onSkip?.(action, new Date(scheduledAt), reason)
                } catch (error: unknown) {
                    void log(runtime, error, `The onSkip handler of the scheduled action ${action.name} failed`)
                }
            }

            /**
             * Run an action
             * @param action
             * @param scheduledAt
             */
            const fire = (action: ChannelActionInfo, scheduledAt: number): void => {
                if (stopped) return
                const state: ActionState = states.get(action)!
                if (state.running && !action.address.overlap) return skip(action, scheduledAt, 'overlap')
                state.running++
                const exclusive: ScheduleLocks | undefined = locks.get(action)
                void (async (): Promise<void> => {
                    let lock: { release(): Promise<unknown> } | undefined
                    try {
                        if (exclusive) {
                            lock = await exclusive.tryAcquire(`schedule:${action.address.exclusiveKey ?? action.name}`)
                            //Run by another instance
                            if (!lock) return skip(action, scheduledAt, 'exclusive')
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
