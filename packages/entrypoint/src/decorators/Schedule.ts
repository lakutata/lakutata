import {Controller, type ControllerProperty} from '../lib/Controller.js'
import {MethodDecorator} from '@lakutata/core'
import {RegisterControllerAction} from '../lib/ControllerEntrypoint.js'
import {ActionOptions} from '../lib/ActionOptions.js'
import {GetActionDTOAndOptions} from '../lib/GetActionDTOAndOptions.js'
import {ScheduleContext} from '../context/ScheduleContext.js'
import {ScheduleChannel} from '../channel/BuiltinChannels.js'
import {Cron, ParseDuration} from '../lib/schedule/Cron.js'

/**
 * When an action runs: every interval, or at the times of a cron expression
 */
export type ScheduleOptions = ({
    /**
     * The interval of the runs: milliseconds, or a text such as "500ms", "30s", "5m", "1h30m", "1d"
     */
    every: number | string
    cron?: never
    timezone?: never
} | {
    /**
     * The times of the runs: "second minute hour day-of-month month day-of-week" (the second is optional), or a macro (@hourly, @daily…)
     */
    cron: string
    /**
     * The IANA time zone of the expression ("Asia/Shanghai"), the time zone of the application by default
     */
    timezone?: string
    every?: never
}) & {
    /**
     * Run while the previous run of the action is still in progress, false by default: the run is skipped
     */
    overlap?: boolean
    /**
     * Also run once the application launched, false by default
     */
    immediate?: boolean
    /**
     * Run in one instance of the application at a time (the locks of a mutex component, @lakutata/mutex): each run by
     * the instance acquiring its lock, the other ones skipping it; the intervals aligned on their multiples (the same
     * times in every instance). true uses the component named "mutex"; key names the lock, the name of the action by
     * default
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
            every = ParseDuration(schedule)
        } catch {
            every = undefined
        }
        options = every === undefined ? {cron: schedule} : {every: schedule}
    } else {
        options = schedule
    }
    const address: Record<string, string | number | boolean> = {}
    if (options.every !== undefined) {
        address.every = ParseDuration(options.every)
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
 * Method Decorator, run the action on a schedule when the entrypoint has a schedule adapter (schedule: ScheduleEntrypoint()).
 * A text is an interval ("30s", "1h30m") or a cron expression ("0 *\/5 * * * *", "@daily")
 * @param schedule
 */
export function Schedule<ClassPrototype extends Controller, Method>(schedule: string | ScheduleOptions): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Method Decorator, run the action on a schedule when the entrypoint has a schedule adapter (schedule: ScheduleEntrypoint()).
 * A text is an interval ("30s", "1h30m") or a cron expression ("0 *\/5 * * * *", "@daily")
 * @param schedule
 * @param actionOptions
 */
export function Schedule<ClassPrototype extends Controller, Method>(schedule: string | ScheduleOptions, actionOptions: ActionOptions<ScheduleContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
export function Schedule<ClassPrototype extends Controller, Method>(schedule: string | ScheduleOptions, actionOptions?: ActionOptions<ScheduleContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>> {
    return (target: ClassPrototype, propertyKey: ControllerProperty<ClassPrototype>, descriptor: TypedPropertyDescriptor<Method>): TypedPropertyDescriptor<Method> => {
        const [dtoConstructor, options] = GetActionDTOAndOptions(actionOptions ?? {})
        RegisterControllerAction(ScheduleChannel, target, propertyKey, ScheduleAddress(schedule), dtoConstructor, options)
        return descriptor
    }
}
