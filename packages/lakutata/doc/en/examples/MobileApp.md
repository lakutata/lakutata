# A mobile application

This example builds an expense book for Android, iOS and HarmonyOS: the user writes down what they spend, and sees the
total of each month and of each category. It starts from the `mobile-react` template and shows the two sides of a mobile
application made with lakutata: the Node.js side, a lakutata application running in the Node.js that the mobile
application embeds, which keeps the expenses in an SQLite database of the data directory of the application and brings
the database up to date with its migrations; and the user interface of React Native, the same on the three systems,
which calls the actions of the Node.js side through the native module and receives its events. It also shows the tests
of the Node.js side, which run on the computer, without a device.

| Message | What it does |
|---|---|
| `{cmd: 'expenses.add', amount: 1250, category: 'Food', note: 'Lunch', spentOn: '2026-11-04'}` | Adds an expense of 12.50 |
| `{cmd: 'expenses.month', month: '2026-11'}` | Gives the expenses of November 2026, their total and the total of each category |
| `{cmd: 'expenses.delete', id: 1}` | Deletes an expense |

When an expense is added or deleted, the Node.js side pushes the `expenses.changed` event, with its month, to the user
interface.

## 1. Create the project

```bash
npx @lakutata/cli create --name expenses --template mobile-react --yes
cd expenses
npm install better-sqlite3 -w app
rm packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
```

The root of the project is the application of React Native, with its native projects `android`, `ios` and `harmony`; its
parts are packages of a workspace ([ProjectStructure](../ProjectStructure.md)): `packages/app` is the Node.js side,
`packages/ui` the user interface, and `packages/ipc` what connects them. The README of the project lists what each
system needs on the computer: the Android SDK with its NDK, Xcode, DevEco Studio. The Node.js side uses SQLite through
`better-sqlite3`, installed here: an addon in C++, which `lakutata mobile stage` builds from its sources for each system
with those tools ([DatabaseDrivers](../DatabaseDrivers.md), section "The mobile applications"). The example controller
of the template is removed.

## 2. The entity

**`packages/app/src/entities/Expense.ts`**

```typescript
import {Column, CreateDateColumn, Entity, PrimaryGeneratedColumn} from 'lakutata/decorator/orm'

/**
 * An expense: its amount in cents, its category, a note, and the day it was spent on
 */
@Entity('expenses')
export class Expense {
    @PrimaryGeneratedColumn()
    public id: number

    @Column({type: 'integer'})
    public amount: number

    @Column({type: 'varchar', length: 40})
    public category: string

    @Column({type: 'varchar', length: 200, default: ''})
    public note: string

    //The day as YYYY-MM-DD: its first seven characters are the month
    @Column({type: 'varchar', length: 10})
    public spentOn: string

    @CreateDateColumn()
    public createdAt: Date
}
```

An entity is a class whose decorators describe its table ([Entities](../Entities.md)). An amount is an integer of cents:
12.50 is 1250, and the totals add integers, without the rounding errors of decimal numbers. The day is text,
`YYYY-MM-DD`, so the expenses of a month are those whose day starts with `2026-11-`.

## 3. The migration

**`packages/app/src/migrations/1793722916138-database.ts`**

```typescript
import { MigrationInterface, QueryRunner } from "lakutata/orm";

export class Migrations1793722916138 implements MigrationInterface {
    name = 'Migrations1793722916138'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "expenses" (
                "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                "amount" integer NOT NULL,
                "category" varchar(40) NOT NULL,
                "note" varchar(200) NOT NULL DEFAULT (''),
                "spentOn" varchar(10) NOT NULL,
                "createdAt" datetime NOT NULL DEFAULT (datetime('now'))
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP TABLE "expenses"
        `);
    }

}
```

The database lives on the device of each user, and an update of the application has to bring it up to date: its schema
changes through migrations, never through `synchronize`, which may drop a column with its data
([Migrations](../Migrations.md)). The application wrote this one itself, from its entities, with the
`lakutata migration` command ([Migrations](../Migrations.md), section 2), run on the computer, where its database is
`packages/app/data/expenses.sqlite`:

```bash
npx lakutata migration generate --package app
```

The migration you generate has another timestamp in its name: import it in the options under that name (section 7). When
an entity changes, bring the database of the computer up to date first, with `npx lakutata migration run --package app`,
as the command compares the entities with its tables; then generate the next migration, which the options list after
this one.

## 4. The input

**`packages/app/src/dtos/ExpenseDTO.ts`**

```typescript
import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

/**
 * An expense by its id
 */
export class ExpenseIdDTO extends DTO {
    @Expect(DTO.Number().integer().positive().required())
    public id: number
}

/**
 * A new expense
 */
export class AddExpenseDTO extends DTO {
    //In cents (12.50 is 1250): integers add up without the rounding errors of decimal numbers
    @Expect(DTO.Number().integer().positive().max(100000000).required())
    public amount: number

    @Expect(DTO.String().min(1).max(40).required())
    public category: string

    @Expect(DTO.String().allow('').max(200).optional().default(''))
    public note: string

    //The day of the device, which the user interface gives: the time zone of the user decides what today is
    @Expect(DTO.String().pattern(/^\d{4}-\d{2}-\d{2}$/, 'day').required())
    public spentOn: string
}

/**
 * A month, as YYYY-MM
 */
export class MonthDTO extends DTO {
    @Expect(DTO.String().pattern(/^\d{4}-(0[1-9]|1[0-2])$/, 'month').required())
    public month: string
}
```

Each action validates its input with a DTO before it runs ([DTOValidation](../DTOValidation.md)). A message is JSON, so
its values keep their types: `amount` must be an integer, and `12.5` is refused with `"amount" must be an integer`. The
day is the one of the device, which the user interface gives: the Node.js side does not decide what today is for the
user.

## 5. The exception

**`packages/app/src/exceptions/ExpenseNotFoundException.ts`**

```typescript
import {Exception} from 'lakutata'

/**
 * The expense of the request does not exist
 */
export class ExpenseNotFoundException extends Exception {
    public errno: string = 'E_EXPENSE_NOT_FOUND'
}
```

An exception has an `errno`, the code that the user interface checks ([Exceptions](../Exceptions.md)). The user
interface receives the error as it was thrown, with all its properties: `ipc.invoke()` rejects with it.

## 6. The controller

**`packages/app/src/controllers/ExpenseController.ts`**

```typescript
import {Controller, type Entrypoint} from 'lakutata/com/entrypoint'
import {type Database} from 'lakutata/com/database'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'
import {Like, type Repository} from 'lakutata/orm'
import {Expense} from '../entities/Expense.js'
import {AddExpenseDTO, ExpenseIdDTO, MonthDTO} from '../dtos/ExpenseDTO.js'
import {ExpenseNotFoundException} from '../exceptions/ExpenseNotFoundException.js'

/**
 * The expenses of a month: their total, the total of each category (the largest first), and the expenses (the latest
 * first)
 */
export type MonthSummary = { month: string, total: number, categories: { category: string, total: number }[], expenses: Expense[] }

/**
 * The actions of the expenses, invoked by the user interface: ipc.invoke({cmd: 'expenses.month', month: '2026-11'})
 */
export class ExpenseController extends Controller {

    /**
     * Pushes the events to the clients: the user interface (ipc.on), the tools in development (GET /events)
     */
    @Inject('entrypoint')
    protected readonly entrypoint: Entrypoint

    @Inject('database')
    protected readonly database: Database

    protected get expenses(): Repository<Expense> {
        return this.database.getRepository(Expense)
    }

    @ServiceAction({cmd: 'expenses.add'}, AddExpenseDTO)
    public async add(input: AddExpenseDTO): Promise<Expense> {
        const expense: Expense = await this.expenses.save(this.expenses.create({amount: input.amount, category: input.category, note: input.note, spentOn: input.spentOn}))
        //The month changed
        this.entrypoint.broadcast('expenses.changed', expense.spentOn.slice(0, 7))
        return expense
    }

    @ServiceAction({cmd: 'expenses.month'}, MonthDTO)
    public async month(input: MonthDTO): Promise<MonthSummary> {
        const expenses: Expense[] = await this.expenses.find({where: {spentOn: Like(`${input.month}-%`)}, order: {spentOn: 'DESC', id: 'DESC'}})
        const totals: Map<string, number> = new Map()
        for (const expense of expenses) totals.set(expense.category, (totals.get(expense.category) ?? 0) + expense.amount)
        return {
            month: input.month,
            total: expenses.reduce((sum: number, expense: Expense): number => sum + expense.amount, 0),
            categories: [...totals].map(([category, total]) => ({category: category, total: total})).sort((a, b): number => b.total - a.total),
            expenses: expenses
        }
    }

    @ServiceAction({cmd: 'expenses.delete'}, ExpenseIdDTO)
    public async remove(input: ExpenseIdDTO): Promise<void> {
        const expense: Expense | null = await this.expenses.findOneBy({id: input.id})
        if (!expense) throw new ExpenseNotFoundException(`The expense ${input.id} does not exist`)
        await this.expenses.remove(expense)
        this.entrypoint.broadcast('expenses.changed', expense.spentOn.slice(0, 7))
    }
}
```

- Each `@ServiceAction` is called by a message ([ServiceCalls](../ServiceCalls.md), section 2): the user interface sends
  it with `ipc.invoke({cmd: 'expenses.month', month: '2026-11'})`, through the native module and its socket to Node.js.
- `this.entrypoint.broadcast()` pushes `expenses.changed` to every client: the user interface, and the tools of the
  development (section 10). Its argument is the month that changed, so a user interface showing another month does not
  load it again.
- `Like` comes from `lakutata/orm`, the API of TypeORM ([Database](../Database.md)).

## 7. The options of the application

**`packages/app/src/config/Config.ts`**

```typescript
import type {Duplex} from 'node:stream'
import path from 'node:path'
import type {ApplicationOptions} from 'lakutata'
import {buildDatabaseOptions} from 'lakutata/com/database'
import {buildEntrypoints, httpServiceEntrypoint} from 'lakutata/com/entrypoint'
import {reactNativeServiceEntrypoint} from 'lakutata/adapter/react-native'
import {ExpenseController} from '../controllers/ExpenseController.js'
import {Expense} from '../entities/Expense.js'
import {Migrations1793722916138} from '../migrations/1793722916138-database.js'

export type ConfigOptions = {
    mode?: 'development' | 'production'
    /**
     * The host serving the actions to the user interface: 'native', the native module of the mobile application (the
     * socket of LAKUTATA_NODE_FD), or a socket standing for it (the tests); none on the computer of the development
     */
    host?: 'native' | Duplex
    /**
     * The port of an HTTP entrypoint for development, none by default. The tools (Postman, curl) invoke the actions with
     * POST / and the message (the pattern and the input), and receive the events pushed to them with GET /events
     * (Server-Sent Events), giving their client id in the id header (or the id query parameter)
     */
    devPort?: number
}

/**
 * The options of the application, made once the aliases are declared: App.ts gives run() a function that calls it
 * @param options
 */
export function config(options: ConfigOptions = {}): ApplicationOptions {
    return {
        id: 'expenses',
        name: 'expenses',
        mode: options.mode ?? 'development',
        components: {
            //The expenses, in the data directory of the application (@data)
            database: buildDatabaseOptions({
                type: 'better-sqlite3',
                database: path.resolve('@data/expenses.sqlite'),
                entities: [Expense],
                //The migrations go into the bundle of the application; those the database has not run yet run when it
                //connects, so an update of the application brings the database of the device up to date
                migrations: [Migrations1793722916138],
                migrationsRun: true
            }),
            entrypoint: buildEntrypoints({
                controllers: [ExpenseController],
                //The user interface invokes the actions through the native module: ipc.invoke({cmd: 'expenses.month', month: '2026-11'})
                service: [
                    ...options.host === undefined ? [] : [reactNativeServiceEntrypoint(options.host === 'native' ? {} : {socket: options.host})],
                    ...options.devPort === undefined ? [] : [httpServiceEntrypoint({port: options.devPort})]
                ]
            })
        },
        //The database is connected, and brought up to date by its migrations, before the actions are served
        bootstrap: ['database', 'entrypoint']
    }
}
```

- The database is a file of the data directory of the application: `path.resolve('@data/expenses.sqlite')`. The `App.ts`
  of the template declares the alias `@data` for each system: the `files` directory of the application on Android,
  `Library/Application Support` on iOS, `/data/storage/el2/base/files` on HarmonyOS, and `packages/app/data` on the
  computer. The system keeps it until the application is uninstalled, unlike `os.tmpdir()`, its cache.
- `App.ts` gives `run()` a function that calls `config()`: the aliases are declared when the application launches, and
  the options made in that function see `@data` ([Application](../Application.md), section 2). `App.ts` stays as the
  template made it.
- The migrations are listed as classes. The Node.js side is a bundle on the device (`lakutata mobile stage`), without
  the compiled files that a glob such as `build/migrations/*.js` would find. `migrationsRun: true` runs the migrations
  that the database of the device has not run yet when it connects, so an update of the application brings its database
  up to date at its first launch.
- `bootstrap` connects the database, and migrates it, before the actions are served.

## 8. The user interface

**`packages/ui/src/App.tsx`**

```tsx
import {useCallback, useEffect, useState} from 'react'
import {Button, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native'
import {ipc} from 'ipc'

/**
 * An expense, as the actions give it
 */
type Expense = { id: number, amount: number, category: string, note: string, spentOn: string }

/**
 * The expenses of a month, as expenses.month gives them
 */
type MonthSummary = { month: string, total: number, categories: { category: string, total: number }[], expenses: Expense[] }

/**
 * A day of the device as YYYY-MM-DD, in its time zone
 * @param date
 */
function day(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * The month before or after a month (YYYY-MM)
 * @param month
 * @param offset
 */
function shift(month: string, offset: number): string {
    const [year, index] = month.split('-').map(Number)
    return day(new Date(year, index - 1 + offset, 1)).slice(0, 7)
}

/**
 * An amount in cents, as 12.50
 * @param cents
 */
function money(cents: number): string {
    return (cents / 100).toFixed(2)
}

export default function App() {
    const [month, setMonth] = useState<string>(day(new Date()).slice(0, 7))
    const [summary, setSummary] = useState<MonthSummary | null>(null)
    const [amount, setAmount] = useState<string>('')
    const [category, setCategory] = useState<string>('')
    const [note, setNote] = useState<string>('')
    const [failure, setFailure] = useState<string>('')
    const [ended, setEnded] = useState<number | null>(null)

    const load = useCallback((): void => {
        ipc.invoke<MonthSummary>({cmd: 'expenses.month', month: month})
            .then((loaded: MonthSummary): void => setSummary(loaded))
            .catch((error: Error): void => setFailure(error.message))
    }, [month])

    useEffect((): () => void => {
        load()
        //An expense was added or deleted: the month shown is loaded again if it is the one that changed
        return ipc.on('expenses.changed', (changed: string): void => {
            if (changed === month) load()
        })
    }, [load, month])

    //Node.js ended (process.exit(), an uncaught exception): the mobile application keeps running
    useEffect((): () => void => ipc.on('exit', (code: number): void => setEnded(code)), [])

    const restart = (): void => {
        setEnded(null)
        ipc.restart()
        load()
    }

    const add = (): void => {
        setFailure('')
        //12.5 or 12,50 as cents
        const cents: number = Math.round(Number(amount.replace(',', '.')) * 100)
        ipc.invoke({cmd: 'expenses.add', amount: cents, category: category.trim(), note: note.trim(), spentOn: day(new Date())})
            .then((): void => {
                setAmount('')
                setNote('')
            })
            .catch((error: Error): void => setFailure(error.message))
    }

    const remove = (id: number): void => {
        ipc.invoke({cmd: 'expenses.delete', id: id}).catch((error: Error): void => setFailure(error.message))
    }

    return (
        //A tap on a button reaches it while the keyboard is shown (by default, the tap only hides the keyboard)
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
            <View style={styles.row}>
                <Button title="‹" onPress={(): void => setMonth(shift(month, -1))}/>
                <Text style={styles.title}>{month}</Text>
                <Button title="›" onPress={(): void => setMonth(shift(month, 1))}/>
            </View>
            <Text style={styles.total}>{money(summary?.total ?? 0)}</Text>
            {summary?.categories.map(({category: name, total}) => (
                <Text key={name} style={styles.text}>{name}: {money(total)}</Text>
            ))}
            <TextInput style={styles.input} placeholder="Amount" keyboardType="decimal-pad" value={amount} onChangeText={setAmount}/>
            <TextInput style={styles.input} placeholder="Category" value={category} onChangeText={setCategory}/>
            <TextInput style={styles.input} placeholder="Note" value={note} onChangeText={setNote}/>
            <Button title="Add today's expense" onPress={add}/>
            {failure !== '' && <Text style={styles.failure}>{failure}</Text>}
            {ended !== null && (
                <>
                    <Text style={styles.failure}>Node.js ended (exit code {ended})</Text>
                    <Button title="Restart" onPress={restart}/>
                </>
            )}
            {summary?.expenses.map((expense: Expense) => (
                <Pressable key={expense.id} style={styles.expense} onLongPress={(): void => remove(expense.id)}>
                    <Text style={styles.text}>{expense.spentOn}  {expense.category}  {money(expense.amount)}</Text>
                    {expense.note !== '' && <Text style={styles.note}>{expense.note}</Text>}
                </Pressable>
            ))}
            {summary?.expenses.length ? <Text style={styles.note}>Hold an expense to delete it</Text> : null}
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    container: {padding: 24, paddingTop: 72},
    //Centered: the corners of the top of the screen are the status bar's on some devices
    row: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24},
    title: {fontSize: 20, fontWeight: 'bold'},
    total: {fontSize: 32, fontWeight: 'bold', marginVertical: 16, textAlign: 'center'},
    text: {fontSize: 16, marginBottom: 4},
    note: {fontSize: 14, color: '#666'},
    input: {borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 10, marginVertical: 6, fontSize: 16},
    failure: {color: '#c00', marginVertical: 8},
    expense: {paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee'}
})
```

- `ipc` comes from the `ipc` package of the template: `ipc.invoke()` calls an action and gives its `payload`, or rejects
  with its error; `ipc.on()` listens to an event and returns the function that removes the listener.
- The month shown is loaded again on `expenses.changed` when it is the month that changed.
- `keyboardShouldPersistTaps="handled"` lets a tap on a button reach it while the keyboard is shown: by default, the tap
  only hides the keyboard, and the expense typed is not added.
- When Node.js ends (an uncaught exception, `process.exit()`), the mobile application keeps running: `ipc` emits `exit`,
  and `ipc.restart()` starts Node.js again, as in the template.

## 9. Run it

Start Metro in a terminal of its own, then the application on an emulator (or a device):

```bash
npm start
npm run android     # or: npm run ios, npm run harmony
```

`npm run android` builds the packages, makes the Node.js project of the application (`lakutata mobile stage`: the bundle
of the Node.js side, and `better-sqlite3` built for the architectures of Android), builds the debug application,
installs it and starts it. The first time, it downloads the libnode of the system. The user interface comes from Metro,
and its changes show at once; a change of `packages/app` is put into the installed application by
`npm run deploy:android` (or `deploy:ios`, `deploy:harmony`), without installing it again.

Add an expense, close the application (on Android, swipe it away from the recent applications), and open it again: the
month still lists the expense, read from the database of the data directory. Hold an expense to delete it.

## 10. Try it on the computer

`npm run dev -w app` runs the Node.js side on the computer, its database in `packages/app/data`, and serves its actions
over HTTP on port 9000 (`DEV_PORT`) for tools such as curl or Postman: `POST /` sends a message, and `GET /events`
streams the events of a client ([ServiceCalls](../ServiceCalls.md), section 4).

```bash
npm run dev -w app
```

In another terminal:

```bash
curl -N 'localhost:9000/events?id=me' &
# event: client
# data: ["me"]

curl -X POST localhost:9000/ -H 'Content-Type: application/json' -d '{"cmd": "expenses.add", "amount": 1250, "category": "Food", "note": "Lunch", "spentOn": "2026-11-04"}'
# {"success":true,"error":null,"payload":{"amount":1250,"category":"Food","note":"Lunch","spentOn":"2026-11-04","id":1,"createdAt":"2026-11-03T16:30:55.000Z"}}
# event: expenses.changed
# data: ["2026-11"]

curl -X POST localhost:9000/ -H 'Content-Type: application/json' -d '{"cmd": "expenses.add", "amount": 4000, "category": "Transport", "note": "Train", "spentOn": "2026-11-04"}'

curl -X POST localhost:9000/ -H 'Content-Type: application/json' -d '{"cmd": "expenses.month", "month": "2026-11"}'
# {"success":true,"error":null,"payload":{"month":"2026-11","total":5250,"categories":[{"category":"Transport","total":4000},{"category":"Food","total":1250}],"expenses":[{"id":2,"amount":4000,"category":"Transport","note":"Train","spentOn":"2026-11-04","createdAt":"2026-11-03T16:30:55.000Z"},{"id":1,"amount":1250,"category":"Food","note":"Lunch","spentOn":"2026-11-04","createdAt":"2026-11-03T16:30:55.000Z"}]}}

curl -X POST localhost:9000/ -H 'Content-Type: application/json' -d '{"cmd": "expenses.add", "amount": 12.5, "category": "Food", "spentOn": "2026-11-04"}'
# {"success":false,"error":{…,"statusCode":400,"message":"\"amount\" must be an integer","errMsg":"\"amount\" must be an integer","err":"InvalidValueException","errno":"E_INVALID_VALUE"},"payload":null}

curl -X POST localhost:9000/ -H 'Content-Type: application/json' -d '{"cmd": "expenses.delete", "id": 7}'
# {"success":false,"error":{…,"message":"The expense 7 does not exist","errMsg":"The expense 7 does not exist","err":"ExpenseNotFoundException","errno":"E_EXPENSE_NOT_FOUND"},"payload":null}
```

The errors carry all the properties of the exception, including its stack (left out here).

## 11. Test it

**`packages/app/src/tests/App.spec.ts`**

```typescript
import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {existsSync, mkdtempSync, rmSync} from 'node:fs'
import {connect, createServer, type Server, type Socket} from 'node:net'
import os from 'node:os'
import path from 'node:path'
import {Application} from 'lakutata'
import type {ReactNativeServiceMessage} from 'lakutata/adapter/react-native'
import type {MonthSummary} from '../controllers/ExpenseController.js'
import {config} from '../config/Config.js'

/**
 * The native module of the mobile application in the tests: its end of the socket to the application, the messages
 * it received (a line of JSON each)
 */
const received: ReactNativeServiceMessage[] = []
let host: Socket

let next: number = 0

/**
 * Write a message as the native module does, a line of JSON
 * @param message
 */
function send(message: Record<string, unknown>): void {
    host.write(`${JSON.stringify(message)}\n`)
}

/**
 * Invoke an action as the user interface does (ipc.invoke)
 * @param data
 */
async function invoke(data: Record<string, unknown>): Promise<any> {
    const id: number = ++next
    send({type: 'invoke', id: id, clientId: 'ui', data: data})
    for (let attempt: number = 0; attempt < 500; attempt++) {
        const response = received.find((message: ReactNativeServiceMessage): boolean => message.type === 'response' && message.id === id)
        if (response) return response.response
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 10))
    }
    throw new Error(`No response to ${JSON.stringify(data)}`)
}

/**
 * Two sockets connected to each other: the end of the native module, the end of the application
 */
async function connectedPair(): Promise<[Socket, Socket]> {
    const server: Server = createServer()
    await new Promise<void>((resolve: () => void): unknown => server.listen(0, '127.0.0.1', resolve))
    const accepted: Promise<Socket> = new Promise((resolve: (socket: Socket) => void): unknown => server.once('connection', resolve))
    const native: Socket = connect((server.address() as { port: number }).port, '127.0.0.1')
    const application: Socket = await accepted
    server.close()
    return [native, application]
}

describe('expenses', (): void => {

    let app: Application
    let socket: Socket
    //The data directory of the tests, where the database is
    const data: string = mkdtempSync(path.join(os.tmpdir(), 'expenses-'))

    before(async (): Promise<void> => {
        ;[host, socket] = await connectedPair()
        let buffer: string = ''
        host.setEncoding('utf8')
        host.on('data', (chunk: string): void => {
            buffer += chunk
            for (let end: number = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
                received.push(JSON.parse(buffer.slice(0, end)) as ReactNativeServiceMessage)
                buffer = buffer.slice(end + 1)
            }
        })
        app = await new Promise<Application>((resolve: (app: Application) => void): void => {
            //@data declared as App.ts does, before the options are made: they are given by a function
            Application
                .alias({'@data': data}, true)
                .run(() => config({host: socket}))
                .onLaunched((launched: Application): void => resolve(launched))
        })
    })

    after(async (): Promise<void> => {
        await app?.dispose()
        host?.destroy()
        socket?.destroy()
        rmSync(data, {recursive: true, force: true})
    })

    it('adds the expenses, and gives the totals of a month', async (): Promise<void> => {
        await invoke({cmd: 'expenses.add', amount: 1250, category: 'Food', note: 'Lunch', spentOn: '2026-11-03'})
        await invoke({cmd: 'expenses.add', amount: 4000, category: 'Transport', spentOn: '2026-11-04'})
        await invoke({cmd: 'expenses.add', amount: 830, category: 'Food', spentOn: '2026-11-04'})
        await invoke({cmd: 'expenses.add', amount: 9900, category: 'Food', spentOn: '2026-10-31'})
        const month: MonthSummary = (await invoke({cmd: 'expenses.month', month: '2026-11'})).payload
        assert.strictEqual(month.total, 6080)
        assert.deepStrictEqual(month.categories, [{category: 'Transport', total: 4000}, {category: 'Food', total: 2080}])
        assert.deepStrictEqual(month.expenses.map((expense): string => `${expense.spentOn} ${expense.amount}`), ['2026-11-04 830', '2026-11-04 4000', '2026-11-03 1250'])
    })

    it('pushes expenses.changed to the user interface', async (): Promise<void> => {
        //The user interface subscribed to the events, the subscription answered
        send({type: 'subscribe', clientId: 'ui'})
        await invoke({cmd: 'expenses.add', amount: 300, category: 'Coffee', spentOn: '2026-11-05'})
        assert.deepStrictEqual(received.filter((message: ReactNativeServiceMessage): boolean => message.type === 'event'), [{type: 'event', clientId: 'ui', event: 'expenses.changed', args: ['2026-11']}])
    })

    it('deletes an expense, and refuses one that does not exist', async (): Promise<void> => {
        const [latest] = (await invoke({cmd: 'expenses.month', month: '2026-11'})).payload.expenses
        assert.strictEqual((await invoke({cmd: 'expenses.delete', id: latest.id})).success, true)
        assert.strictEqual((await invoke({cmd: 'expenses.month', month: '2026-11'})).payload.total, 6080)
        const missing = await invoke({cmd: 'expenses.delete', id: latest.id})
        assert.strictEqual(missing.success, false)
        assert.strictEqual(missing.error.errno, 'E_EXPENSE_NOT_FOUND')
    })

    it('refuses an invalid input', async (): Promise<void> => {
        const decimal = await invoke({cmd: 'expenses.add', amount: 12.5, category: 'Food', spentOn: '2026-11-03'})
        assert.strictEqual(decimal.success, false)
        assert.match(decimal.error.message, /amount/)
        const month = await invoke({cmd: 'expenses.month', month: '2026-13'})
        assert.strictEqual(month.success, false)
        assert.match(month.error.message, /month/)
    })

    it('keeps the database in the data directory', async (): Promise<void> => {
        assert.ok(existsSync(path.join(data, 'expenses.sqlite')))
    })
})
```

The tests run the Node.js side on the computer, the way the native module runs it on a device: a socket stands for the
one of the native module, and the tests write its messages, a line of JSON each (`invoke`, `subscribe`), and read the
responses and the events. `@data` is a temporary directory, declared as `App.ts` declares it, before the options are
made by the function given to `run()`.

```bash
npm test
```

```
app │   ✔ adds the expenses, and gives the totals of a month
app │   ✔ pushes expenses.changed to the user interface
app │   ✔ deletes an expense, and refuses one that does not exist
app │   ✔ refuses an invalid input
app │   ✔ keeps the database in the data directory
app │ ℹ pass 5
✔ test ran in app
```

The tests use the `better-sqlite3` installed for the Node.js of the computer; the one of each system is built by
`lakutata mobile stage`.

## 12. Release it

The release builds of the three systems come from their native projects: they bundle the user interface into the
application instead of loading it from Metro, and are signed for their stores. The section "The packaging" of the README
of the project gives their commands; make the Node.js project first, with `npm run stage:android` (or `stage:ios`,
`stage:harmony`). The Node.js side is the same in the debug and the release builds, and so are its data directory and
its migrations: an update installed over an older version keeps the database, and its first launch runs the new
migrations.

<!--
check:
  create: expenses mobile-react
  remove: packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
  run: npm test
-->
