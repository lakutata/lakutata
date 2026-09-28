import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Container} from '@lakutata/core'
import {
    ActionInvocation,
    BuildEntrypoints,
    ChannelActionInfo,
    Controller,
    Cron,
    Entrypoint,
    MiddlewareHandler,
    Next,
    ParseDuration,
    ScheduleContext,
    ScheduleEntrypoint,
    ScheduleEntrypointOptions
} from '../exports/Entrypoint.js'
import {Schedule} from '../exports/CTRLDecorators.js'

/**
 * Wait
 * @param ms
 */
function Sleep(ms: number): Promise<void> {
    return new Promise((resolve: () => void): unknown => setTimeout(resolve, ms))
}

describe('Cron', (): void => {

    it('finds the next times', (): void => {
        const next = (expression: string, after: string, timezone: string = 'UTC'): string | undefined => new Cron(expression, timezone).next(new Date(after))?.toISOString()
        assert.strictEqual(next('*/15 * * * *', '2026-01-01T00:07:30Z'), '2026-01-01T00:15:00.000Z')
        assert.strictEqual(next('*/10 * * * * *', '2026-01-01T00:00:05Z'), '2026-01-01T00:00:10.000Z')
        assert.strictEqual(next('@daily', '2026-01-01T00:00:00Z'), '2026-01-02T00:00:00.000Z')
        assert.strictEqual(next('0 0 1 jan *', '2026-06-01T00:00:00Z'), '2027-01-01T00:00:00.000Z')
        //A leap day
        assert.strictEqual(next('0 0 29 2 *', '2026-03-01T00:00:00Z'), '2028-02-29T00:00:00.000Z')
        //The day of the month or the day of the week, when both are restricted
        assert.strictEqual(next('0 0 13 * FRI', '2026-02-01T00:00:00Z'), '2026-02-06T00:00:00.000Z')
        assert.strictEqual(next('0 0 * * 7', '2026-02-01T00:00:00Z'), '2026-02-08T00:00:00.000Z')
        //In a time zone: the weekdays at 9 in Shanghai, after a Saturday
        assert.strictEqual(next('0 9 * * MON-FRI', '2026-09-26T04:00:00Z', 'Asia/Shanghai'), '2026-09-28T01:00:00.000Z')
        assert.strictEqual(new Cron('0 0 30 2 *').next(), undefined)
    })

    it('follows the daylight saving time', (): void => {
        //The clocks skip 2:00 to 3:00 on 2026-03-08 in New York: 2:30 does not exist that day
        assert.strictEqual(new Cron('30 2 * * *', 'America/New_York').next(new Date('2026-03-07T12:00:00Z'))?.toISOString(), '2026-03-09T06:30:00.000Z')
        //The clocks go back from 2:00 to 1:00 on 2026-11-01: 1:30 comes twice, it runs once
        const cron: Cron = new Cron('30 1 * * *', 'America/New_York')
        const first: Date = cron.next(new Date('2026-10-31T12:00:00Z'))!
        assert.strictEqual(first.toISOString(), '2026-11-01T05:30:00.000Z')
        assert.strictEqual(cron.next(first)?.toISOString(), '2026-11-02T06:30:00.000Z')
    })

    it('rejects the invalid expressions and durations', (): void => {
        assert.throws((): unknown => new Cron('61 * * * *'), /"61" is not a value from 0 to 59/)
        assert.throws((): unknown => new Cron('* * * *'), /5 or 6 fields/)
        assert.throws((): unknown => new Cron('0 5-1 * * *'), /reversed/)
        assert.throws((): unknown => new Cron('* * * * *', 'Mars/Olympus'))
        assert.strictEqual(ParseDuration('1h30m'), 5400000)
        assert.strictEqual(ParseDuration('500ms'), 500)
        assert.strictEqual(ParseDuration(250), 250)
        assert.throws((): number => ParseDuration('soon'), /Invalid duration/)
    })
})

const runs: { name: string, context: ScheduleContext }[] = []

let slowRunning: number = 0

let slowConcurrency: number = 0

class JobController extends Controller {

    @Schedule('40ms')
    public async tick(): Promise<void> {
        runs.push({name: 'tick', context: this.context as ScheduleContext})
    }

    @Schedule({every: 20, immediate: true}, {name: 'slow job'})
    public async slow(): Promise<void> {
        slowRunning++
        slowConcurrency = Math.max(slowConcurrency, slowRunning)
        await Sleep(90)
        slowRunning--
    }

    @Schedule({every: '30ms', overlap: true})
    public async parallel(): Promise<void> {
        runs.push({name: 'parallel', context: this.context as ScheduleContext})
        await Sleep(90)
    }

    @Schedule('* * * * * *')
    public async everySecond(): Promise<void> {
        runs.push({name: 'cron', context: this.context as ScheduleContext})
    }

    @Schedule({every: '25ms'})
    public async failing(): Promise<void> {
        throw new Error('The job failed')
    }
}

/**
 * Run the schedule for a while
 * @param options
 * @param entrypointOptions
 */
async function Start(options: ScheduleEntrypointOptions = {}, entrypointOptions: Record<string, unknown> = {}): Promise<Container> {
    runs.length = 0
    slowRunning = 0
    slowConcurrency = 0
    const container: Container = new Container()
    await container.set(Entrypoint, BuildEntrypoints({controllers: [JobController], ...entrypointOptions, schedule: ScheduleEntrypoint(options)}))
    return container
}

describe('Schedule adapter', (): void => {

    it('runs the actions on their schedule', async (): Promise<void> => {
        const trace: string[] = []
        const traced: MiddlewareHandler = async (invocation: ActionInvocation, next: Next): Promise<unknown> => {
            trace.push(`${invocation.context.type}:${(invocation.context as ScheduleContext).schedule}`)
            return next()
        }
        const errors: string[] = []
        const container: Container = await Start({onError: (error: unknown, action: ChannelActionInfo): void => void errors.push(`${action.name}: ${(error as Error).message}`)}, {middlewares: [traced]})
        await Sleep(1150)
        await container.destroy()
        const ticks: ScheduleContext[] = runs.filter((run): boolean => run.name === 'tick').map((run): ScheduleContext => run.context)
        assert.ok(ticks.length >= 15, `${ticks.length} ticks`)
        assert.deepStrictEqual(ticks.slice(0, 3).map((context: ScheduleContext): number => context.run), [1, 2, 3])
        assert.strictEqual(ticks[0].schedule, 'every 40ms')
        assert.strictEqual(ticks[0].type, 'SCHEDULE')
        assert.ok(ticks[1].scheduledAt.getTime() - ticks[0].scheduledAt.getTime() === 40)
        //Each run has its own controller
        assert.notStrictEqual(runs[0].context, runs[1].context)
        assert.ok(runs.some((run): boolean => run.name === 'cron' && run.context.schedule === 'cron * * * * * *'))
        assert.ok(trace.includes('SCHEDULE:every 40ms'))
        assert.ok(errors.length >= 10 && errors.every((error: string): boolean => error === 'JobController:failing: The job failed'), errors[0])
    })

    it('skips the runs overlapping the previous one, unless the action overlaps', async (): Promise<void> => {
        const skipped: string[] = []
        const container: Container = await Start({onSkip: (action: ChannelActionInfo): void => void skipped.push(action.name), onError: (): void => undefined})
        await Sleep(300)
        await container.destroy()
        assert.strictEqual(slowConcurrency, 1)
        assert.ok(skipped.includes('slow job'))
        assert.ok(!skipped.includes('JobController:parallel'))
        //The runs of the overlapping action were in progress together
        const parallel: ScheduleContext[] = runs.filter((run): boolean => run.name === 'parallel').map((run): ScheduleContext => run.context)
        assert.ok(parallel.length >= 5, `${parallel.length} runs`)
    })

    it('runs immediately and waits for the runs in progress when it stops', async (): Promise<void> => {
        const container: Container = await Start({onError: (): void => undefined})
        //The slow job runs immediately
        await Sleep(10)
        assert.strictEqual(slowRunning, 1)
        await container.destroy()
        assert.strictEqual(slowRunning, 0)
        const count: number = runs.length
        await Sleep(100)
        assert.strictEqual(runs.length, count)
    })

    it('runs nothing without a schedule adapter', async (): Promise<void> => {
        runs.length = 0
        const container: Container = new Container()
        const entrypoint: Entrypoint = await container.set(Entrypoint, BuildEntrypoints({controllers: [JobController]}))
        await Sleep(100)
        assert.strictEqual(runs.length, 0)
        //The scheduled actions are described
        assert.deepStrictEqual(entrypoint.getActions('schedule').actions.map((action: any): unknown => action.schedule).sort(), ['cron * * * * * *', 'every 20ms', 'every 25ms', 'every 30ms', 'every 40ms'])
        await container.destroy()
    })

    it('rejects the invalid schedules when they are declared', (): void => {
        assert.throws((): void => {
            class InvalidController extends Controller {
                @Schedule({cron: '0 25 * * *'})
                public async job(): Promise<void> {
                }
            }
            void InvalidController
        }, /"25" is not a value from 0 to 23/)
    })
})
