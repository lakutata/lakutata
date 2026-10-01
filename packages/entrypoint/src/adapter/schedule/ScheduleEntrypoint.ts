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
     * A run was skipped: the previous run of the action is still in progress (the action does not overlap)
     */
    onSkip?: (action: ChannelActionInfo, scheduledAt: Date) => void
}

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
        try {
            const log: any = await runtime.module.getObject('log')
            log.error(error, `The scheduled action ${action.name} (${context.schedule}) failed`)
        } catch {
            console.error(`The scheduled action ${action.name} (${context.schedule}) failed:`, error)
        }
    }

    return {
        channel: 'schedule',
        definition: ScheduleChannel,
        name: options.name,
        middlewares: options.middlewares,
        start: (runtime: ChannelRuntime<ScheduleContext>): void => {
            const states: Map<ChannelActionInfo, ActionState> = new Map()

            /**
             * Run an action
             * @param action
             * @param scheduledAt
             */
            const fire = (action: ChannelActionInfo, scheduledAt: number): void => {
                if (stopped) return
                const state: ActionState = states.get(action)!
                if (state.running && !action.address.overlap) return options.onSkip?.(action, new Date(scheduledAt))
                state.running++
                state.runs++
                const context: ScheduleContext = new ScheduleContext({schedule: action.address.schedule, scheduledAt: new Date(scheduledAt), run: state.runs, data: {}})
                runtime.dispatchTo(action, context)
                    .catch((error: unknown): Promise<void> => report(runtime, error, action, context))
                    .catch((): undefined => undefined)
                    .finally((): void => {
                        state.running--
                    })
            }

            /**
             * Plan the runs of an action
             * @param action
             */
            const plan = (action: ChannelActionInfo): void => {
                if (action.address.every !== undefined) {
                    const interval: number = action.address.every
                    let next: number = Date.now() + interval
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
            void runtime.ready.then((): void => {
                if (stopped) return
                for (const action of runtime.actions) {
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
        }
    }
}
