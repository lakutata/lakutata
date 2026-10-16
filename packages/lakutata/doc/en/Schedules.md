# Lakutata Scheduled Jobs

`@Schedule` runs a controller method on a schedule: at a fixed interval, or at the times of a cron expression. The
schedule adapter, `scheduleEntrypoint()` from `lakutata/com/entrypoint`, runs these methods. It needs no other package.

## 1. A first job

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller, scheduleEntrypoint} from 'lakutata/com/entrypoint'
import {Schedule} from 'lakutata/decorator/ctrl'

class JobController extends Controller {
    //Every 30 seconds
    @Schedule('30s')
    public async heartbeat(): Promise<void> {
        console.log('Still alive')
    }

    //At 03:00 every day, in Shanghai time
    @Schedule({cron: '0 3 * * *', timezone: 'Asia/Shanghai'})
    public async purge(): Promise<void> {
        console.log('Purging the expired sessions')
    }
}

Application.run(() => ({
    id: 'jobs.app',
    name: 'Jobs',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [JobController],
            schedule: scheduleEntrypoint()
        })
    },
    bootstrap: ['entrypoint']
}))
```

- The jobs start once the application has launched. The entrypoint must be listed in `bootstrap`, and it needs the
  `schedule` adapter: without it, the methods marked with `@Schedule` never run.
- A job at an interval first runs one interval after launch, not at launch (see `immediate` below to also run it then).
- A job runs in every instance of the application. To run it in one instance at a time, see section 4.

## 2. Writing a schedule

`@Schedule(schedule, options?)` takes the schedule first. The second argument holds the action options shared by all
actions (`name`, `description`, `acl`, `rule`, `middlewares`, `groups`). Unlike the other action decorators, it takes no
DTO: a job has no input. The `@Prefix` of a controller does not apply to its jobs.

The schedule is one of:

| Schedule | Meaning |
|---|---|
| `'30s'`, `'1h30m'`, `'1.5h'` | An interval, written as a duration |
| `5000` | An interval in milliseconds |
| `'0 */5 * * * *'`, `'@daily'` | A cron expression (any string that is not a duration) |
| `{every: '30s', ...}` | An interval, with the options below |
| `{cron: '0 3 * * *', timezone: 'Asia/Shanghai', ...}` | A cron expression, with a time zone and the options below |

A duration is made of numbers followed by a unit: `ms`, `s`, `m`, `h` or `d`. The parts add up (`1h30m`), may have
decimals (`1.5h`), and may be separated by spaces. A number without a unit (`'30'`) is not a duration: it is read as a
cron expression, and fails.

The options of the object form:

| Option | Default | Meaning |
|---|---|---|
| `overlap` | `false` | Start a run even while the previous one is still running. By default that run is skipped |
| `immediate` | `false` | Also run once as soon as the application has launched |
| `exclusive` | `false` | Run in one instance of the application at a time (see section 4) |
| `timezone` | The time zone of the process | The IANA time zone of a cron expression |

### Cron expressions

A cron expression has 6 fields, or 5 without the seconds (the seconds are then 0):

```text
┌──────────── second (0-59), optional
│ ┌────────── minute (0-59)
│ │ ┌──────── hour (0-23)
│ │ │ ┌────── day of the month (1-31)
│ │ │ │ ┌──── month (1-12, or jan-dec)
│ │ │ │ │ ┌── day of the week (0-7, or sun-sat; 0 and 7 are Sunday)
│ │ │ │ │ │
* * * * * *
```

Each field takes `*` (or `?`), a value, a range (`1-5`), a step (`*/15`, `10/15`, `10-40/15`) or a list of these
(`1,15,30`). The names of the months and of the days are not case-sensitive (`mon-fri`). When both the day of the month
and the day of the week are restricted, a day matching either one is a match, as in the classic cron.

The macros are `@yearly` (or `@annually`), `@monthly`, `@weekly`, `@daily` (or `@midnight`) and `@hourly`. `L`, `W`,
`#` and `@reboot` are not supported.

| Expression | Runs |
|---|---|
| `'*/10 * * * * *'` | Every 10 seconds |
| `'0 */5 * * *'` | Every 5 minutes |
| `'30 9 * * mon-fri'` | At 09:30 from Monday to Friday |
| `'0 0 1 * *'` | At midnight on the first day of each month |

**Daylight saving time.** In a time zone that changes its clocks, a time skipped in spring (02:30 in New York on 8 March
2026) does not run that day, and a time repeated in autumn runs once.

**Mistakes.** An invalid interval or cron expression throws a `SyntaxError`, and an unknown time zone a `RangeError`, as
soon as the controller class is defined, before the application starts. A valid expression that never matches, such as
30 February (`'0 0 30 2 *'`), is accepted but never runs, and nothing is logged.

## 3. When the runs happen

- **Intervals.** The first run comes one interval after the launch, then one every interval.
- **Cron.** Each run is planned at the next time that matches the expression.
- **Missed runs** are skipped, not caught up: after the process was suspended (a laptop asleep), the job runs at its
  next planned time.
- **Overlaps.** By default, a run whose previous run is still in progress is skipped. With `overlap: true`, several runs
  of the same job can be in progress at once.
- **`immediate: true`** adds one run as soon as the application has launched.

## 4. Running in one instance only

An application often runs in several instances (several containers, several servers). A job declared with
`exclusive: true` runs in one of them at a time:

```typescript
import {Controller} from 'lakutata/com/entrypoint'
import {Schedule} from 'lakutata/decorator/ctrl'

class ReportController extends Controller {
    //Every 5 minutes, in one instance
    @Schedule({every: '5m', exclusive: true})
    public async build(): Promise<void> {
    }

    //At 03:00 every day, with the lock "schedule:purge" of the component named "locks"
    @Schedule({cron: '0 3 * * *', exclusive: {mutex: 'locks', key: 'purge'}})
    public async purge(): Promise<void> {
    }
}
```

- The application needs a mutex component shared by its instances, named `mutex` unless `exclusive.mutex` names
  another one (see [Mutex](Mutex.md), section 4). Without it, the job does not run and the error is logged.
- Each run first tries to get the lock `schedule:<key>`, where the key is the name of the action unless
  `exclusive.key` sets it. The instances that do not get the lock skip the run.
- The intervals of an exclusive job are aligned on the clock (every 5 minutes means at :00, :05, :10…), so that all the
  instances plan the same times.
- After a run, the lock is held until half the period has passed since the planned time (30 seconds at most), so an
  instance whose clock is a little behind does not run the job again.

## 5. Inside a run

Each run is handled like a request: it gets a new controller in its own scope, and goes through the middlewares and the
access control of the entrypoint. The method receives no input, and the value it returns is ignored.

`this.context` is a `ScheduleContext`:

| Property | Meaning |
|---|---|
| `schedule` | The schedule, as text: `'every 30s'`, `'cron 0 3 * * *'` |
| `scheduledAt` | The planned time of the run (a `Date`); the run may start a few milliseconds later |
| `run` | The number of the run in this process, from 1 (the skipped runs are not counted) |

```typescript
import {Controller, type ScheduleContext} from 'lakutata/com/entrypoint'
import {Schedule} from 'lakutata/decorator/ctrl'

class JobController extends Controller {
    @Schedule({every: '1m', immediate: true})
    public async sync(): Promise<void> {
        const context: ScheduleContext = this.context as ScheduleContext
        console.log(`Run ${context.run} of ${context.schedule}, planned at ${context.scheduledAt.toISOString()}`)
    }
}
```

## 6. Errors and skipped runs

A run that throws does not stop the job: its next runs happen as planned. By default, the error is logged by the
application's logger (the component `log`), or written to the console without one. The options of the adapter replace
this behaviour:

```typescript
import {scheduleEntrypoint} from 'lakutata/com/entrypoint'

export const schedule = scheduleEntrypoint({
    //A run failed
    onError: (error, action, context): void => {
        console.error(`${action.name} failed at ${context.scheduledAt.toISOString()}: ${(error as Error).message}`)
    },
    //A run skipped: the previous one was still in progress ('overlap'), or another instance had the lock ('exclusive')
    onSkip: (action, scheduledAt, reason): void => {
        console.warn(`${action.name} skipped at ${scheduledAt.toISOString()} (${reason})`)
    }
})
```

The adapter also takes `middlewares`, run for the jobs after the middlewares of the entrypoint, and `name`.

## 7. Stopping

When the application stops, no new run starts, and the exclusive jobs release their locks. The runs in progress are
given the `shutdownTimeout` of the entrypoint (30 seconds by default) to finish. After that they are aborted:
`this.signal` is aborted, so that a long job can check it and stop early.

## 8. Computing the next times

`Cron` and `parseDuration`, from `lakutata/com/entrypoint`, are the parsers the jobs use:

```typescript
import {Cron, parseDuration} from 'lakutata/com/entrypoint'

const cron: Cron = new Cron('30 9 * * mon-fri', 'Asia/Shanghai')
//The next time after the given one (to the second), or undefined when it never matches
console.log(cron.next(new Date('2026-10-16T12:00:00Z'))) //2026-10-19T01:30:00.000Z, a Monday at 09:30 in Shanghai
console.log(parseDuration('1h30m')) //5400000
```
