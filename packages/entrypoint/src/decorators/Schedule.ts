import {Controller, type ControllerProperty} from '../lib/Controller.js'
import {MethodDecorator} from '@lakutata/core'
import {registerControllerAction} from '../lib/ControllerEntrypoint.js'
import {ActionOptions} from '../lib/ActionOptions.js'
import {getActionDTOAndOptions} from '../lib/GetActionDTOAndOptions.js'
import {ScheduleContext} from '../context/ScheduleContext.js'
import {ScheduleChannel} from '../channel/BuiltinChannels.js'
import {Cron, parseDuration} from '../lib/schedule/Cron.js'

/**
 * When a scheduled action runs (`@Schedule`): every interval (`every`) or at the times of a cron expression (`cron`),
 * with how its runs overlap, start and are shared between the instances of the application.
 */
export type ScheduleOptions = ({
    /**
     * The interval between the runs: milliseconds, or a duration text such as `'500ms'`, `'30s'`, `'5m'`, `'1h30m'` or
     * `'1d'`. The first run comes one interval after the application launched; the runs missed while the process was
     * suspended are skipped.
     */
    every: number | string
    cron?: never
    timezone?: never
} | {
    /**
     * The times of the runs: a cron expression `'second minute hour day-of-month month day-of-week'` (the second is
     * optional: 5 fields run at second 0), or a macro (`'@hourly'`, `'@daily'`…).
     */
    cron: string
    /**
     * The IANA time zone the expression is read in (`'Asia/Shanghai'`).
     * @default the local time zone of the process
     */
    timezone?: string
    every?: never
}) & {
    /**
     * Start a run while the previous run of the action is still in progress; otherwise the run is skipped.
     * @default false
     */
    overlap?: boolean
    /**
     * Also run the action once as soon as the application launched, besides its schedule.
     * @default false
     */
    immediate?: boolean
    /**
     * Run the action in one instance of the application at a time, with the locks of a mutex component
     * (`lakutata/com/mutex`): each run is made by the instance acquiring its lock, the others skip it, and the intervals
     * are aligned on their multiples so that every instance plans the same times. `true` uses the component named
     * `'mutex'`; `{mutex, key}` names the component and the lock (the action name by default). Without the component,
     * the action does not run and the error is logged.
     * @default false
     */
    exclusive?: boolean | { mutex?: string, key?: string }
}

/**
 * A key for each scheduled action, telling apart the actions of a same schedule
 */
let keys: number = 0

/**
 * The address of a schedule
 * @param schedule
 */
function ScheduleAddress(schedule: string | ScheduleOptions): Record<string, string | number | boolean> {
    let options: ScheduleOptions
    if (typeof schedule === 'string') {
        //A text is an interval ("30s") when it is one, a cron expression otherwise
        let every: number | undefined
        try {
            every = parseDuration(schedule)
        } catch {
            every = undefined
        }
        options = every === undefined ? {cron: schedule} : {every: schedule}
    } else {
        options = schedule
    }
    const address: Record<string, string | number | boolean> = {}
    if (options.every !== undefined) {
        address.every = parseDuration(options.every)
        address.schedule = `every ${typeof options.every === 'number' ? `${options.every}ms` : options.every}`
    } else if (options.cron !== undefined) {
        //The expression is checked now, not at the first run
        new Cron(options.cron, options.timezone)
        address.cron = options.cron
        address.schedule = `cron ${options.cron}`
        if (options.timezone) address.timezone = options.timezone
    } else {
        throw new SyntaxError('A schedule is an interval (every) or a cron expression (cron)')
    }
    address.overlap = options.overlap === true
    address.immediate = options.immediate === true
    if (options.exclusive) {
        address.exclusive = (typeof options.exclusive === 'object' ? options.exclusive.mutex : undefined) ?? 'mutex'
        if (typeof options.exclusive === 'object' && options.exclusive.key) address.exclusiveKey = options.exclusive.key
    }
    address.key = `s${++keys}`
    return address
}

/**
 * Run the controller method on a schedule, when the entrypoint has a schedule adapter (`schedule: scheduleEntrypoint()`
 * of `lakutata/com/entrypoint`). The runs start once the application launched and the runs in progress end before it
 * stops. Each run has its own request scope and goes through the middlewares and the access control like a request; the
 * method receives an empty input, and `this.context` is a `ScheduleContext` (its schedule, its planned time and its run
 * number). The value returned is ignored; an error thrown is given to the adapter's `onError`, or logged by the
 * application's `log` component (to the console without it), and the next runs go on.
 * @param schedule A duration text (`'30s'`, `'1h30m'`) for an interval, any other text for a cron expression
 * (`'0 *\/5 * * * *'`, `'@daily'`), or the schedule options.
 * @returns The method decorator.
 * @throws {SyntaxError} When the class is declared, if the interval or the cron expression is invalid.
 * @throws {RangeError} When the class is declared, if the time zone is unknown.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints, Controller, ScheduleContext, scheduleEntrypoint} from 'lakutata/com/entrypoint'
 * import {Schedule} from 'lakutata/decorator/ctrl'
 *
 * class JobController extends Controller {
 *     //Every 30 seconds, and once as soon as the application launched
 *     @Schedule({every: '30s', immediate: true})
 *     public async heartbeat(): Promise<void> {
 *         if (this.context instanceof ScheduleContext) console.log(`run ${this.context.run} of ${this.context.schedule}`)
 *     }
 *
 *     //Every 5 minutes, at second 0
 *     @Schedule('0 *\/5 * * * *')
 *     public async report(): Promise<void> {
 *     }
 *
 *     //At 03:00 every day in Shanghai, by one instance of the application at a time (a mutex component named "mutex")
 *     @Schedule({cron: '0 3 * * *', timezone: 'Asia/Shanghai', exclusive: true}, {name: 'Purge the expired sessions'})
 *     public async purge(): Promise<void> {
 *     }
 * }
 *
 * Application.run(() => ({
 *     id: 'jobs.app',
 *     name: 'Jobs',
 *     components: {
 *         entrypoint: buildEntrypoints({
 *             controllers: [JobController],
 *             schedule: scheduleEntrypoint({onError: (error: unknown): void => console.error(error)})
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * }))
 * ```
 */
export function Schedule<ClassPrototype extends Controller, Method>(schedule: string | ScheduleOptions): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Run the controller method on a schedule, with action options, when the entrypoint has a schedule adapter
 * (`schedule: scheduleEntrypoint()`). Each run has its own request scope and goes through the middlewares and the access
 * control like a request; the method receives an empty input and `this.context` is a `ScheduleContext`. An error thrown
 * is given to the adapter's `onError`, or logged, and the next runs go on.
 * @param schedule A duration text (`'30s'`, `'1h30m'`) for an interval, any other text for a cron expression
 * (`'0 *\/5 * * * *'`, `'@daily'`), or the schedule options.
 * @param actionOptions The action options: `name` (`ClassName:method` by default) names the action in the logs and is the
 * default lock key of an exclusive schedule; `description` and `groups` describe it; `acl` runs the access control
 * rules (false by default); `rule` is an access rule of the action; `middlewares` run before the ones `@UseMiddlewares`
 * adds to the method.
 * @returns The method decorator.
 * @throws {SyntaxError} When the class is declared, if the interval or the cron expression is invalid.
 * @throws {RangeError} When the class is declared, if the time zone is unknown.
 * @throws {InvalidValueException} When the class is declared, if the action options are invalid.
 */
export function Schedule<ClassPrototype extends Controller, Method>(schedule: string | ScheduleOptions, actionOptions: ActionOptions<ScheduleContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
export function Schedule<ClassPrototype extends Controller, Method>(schedule: string | ScheduleOptions, actionOptions?: ActionOptions<ScheduleContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>> {
    return (target: ClassPrototype, propertyKey: ControllerProperty<ClassPrototype>, descriptor: TypedPropertyDescriptor<Method>): TypedPropertyDescriptor<Method> => {
        const [dtoConstructor, options] = getActionDTOAndOptions(actionOptions ?? {})
        registerControllerAction(ScheduleChannel, target, propertyKey, ScheduleAddress(schedule), dtoConstructor, options)
        return descriptor
    }
}
