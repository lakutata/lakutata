# 手机应用

这个示例构建一个可以在 Android、iOS 和鸿蒙上运行的记账本：用户记下每一笔支出，并查看每个月以及每个分类的合计。它从 `mobile-react` 模板开始，展示用 lakutata 开发的手机应用的两部分：一是 Node.js 端，它是一个 lakutata 应用，运行在手机应用内嵌的 Node.js 中，把支出保存在应用数据目录下的 SQLite 数据库里，并用迁移让数据库保持最新；二是 React Native 用户界面，它在三个系统上完全相同，通过原生模块调用 Node.js 端的动作，并接收 Node.js 端推送的事件。示例还展示了 Node.js 端的测试，测试在电脑上运行，不需要设备。

| 消息 | 作用 |
|---|---|
| `{cmd: 'expenses.add', amount: 1250, category: 'Food', note: 'Lunch', spentOn: '2026-11-04'}` | 添加一笔 12.50 的支出 |
| `{cmd: 'expenses.month', month: '2026-11'}` | 返回 2026 年 11 月的支出、总额和每个分类的合计 |
| `{cmd: 'expenses.delete', id: 1}` | 删除一笔支出 |

添加或删除支出时，Node.js 端会向用户界面推送 `expenses.changed` 事件，参数是对应的月份。

## 1. 创建项目

```bash
npx @lakutata/cli create --name expenses --template mobile-react --yes
cd expenses
npm install better-sqlite3 -w app
rm packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
```

项目的根目录就是 React Native 应用，包含原生项目 `android`、`ios` 和 `harmony`；应用的各部分是工作区中的包（见 [ProjectStructure](../ProjectStructure.md)）：`packages/app` 是 Node.js 端，`packages/ui` 是用户界面，`packages/ipc` 负责把两者连起来。项目的 README 列出了每个系统在电脑上需要的工具：带 NDK 的 Android SDK、Xcode、DevEco Studio。Node.js 端通过这里安装的 `better-sqlite3` 使用 SQLite：它是一个 C++ 插件，`lakutata mobile stage` 会用这些工具为每个系统从源码编译它（见 [DatabaseDrivers](../DatabaseDrivers.md) 的“手机应用”一节）。这里删掉了模板中的示例控制器。

## 2. 实体

**`packages/app/src/entities/Expense.ts`**

```typescript
import {Column, CreateDateColumn, Entity, PrimaryGeneratedColumn} from 'lakutata/decorator/orm'

/**
 * 一笔支出：金额（单位为分）、分类、备注，以及花钱的日期
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

    //日期，格式为 YYYY-MM-DD：前七个字符就是月份
    @Column({type: 'varchar', length: 10})
    public spentOn: string

    @CreateDateColumn()
    public createdAt: Date
}
```

实体是一个类，它的装饰器描述对应的表（见 [Entities](../Entities.md)）。金额是以分为单位的整数：12.50 就是 1250，合计时相加的是整数，没有小数的舍入误差。日期是 `YYYY-MM-DD` 格式的文本，所以一个月的支出就是日期以 `2026-11-` 开头的那些。

## 3. 迁移

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

数据库在每个用户的设备上，应用更新时必须把它更新到最新：表结构的变化通过迁移完成，绝不能用 `synchronize`，因为它可能连同数据一起删掉某一列（见 [Migrations](../Migrations.md)）。这个迁移是应用根据实体自己生成的，用的是 `lakutata migration` 命令（见 [Migrations](../Migrations.md) 第 2 节），在电脑上运行，电脑上的数据库是 `packages/app/data/expenses.sqlite`：

```bash
npx lakutata migration generate --package app
```

你生成的迁移文件名中的时间戳会不一样：在选项中按那个名称导入它（见第 7 节）。实体有变化时，先用 `npx lakutata migration run --package app` 把电脑上的数据库更新到最新，因为这个命令是拿实体和数据库中的表作比较；然后生成下一个迁移，并在选项中把它列在这一个之后。

## 4. 输入

**`packages/app/src/dtos/ExpenseDTO.ts`**

```typescript
import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

/**
 * 按 id 指定的一笔支出
 */
export class ExpenseIdDTO extends DTO {
    @Expect(DTO.Number().integer().positive().required())
    public id: number
}

/**
 * 一笔新支出
 */
export class AddExpenseDTO extends DTO {
    //单位为分（12.50 就是 1250）：整数相加没有小数的舍入误差
    @Expect(DTO.Number().integer().positive().max(100000000).required())
    public amount: number

    @Expect(DTO.String().min(1).max(40).required())
    public category: string

    @Expect(DTO.String().allow('').max(200).optional().default(''))
    public note: string

    //设备上的日期，由用户界面给出：今天是哪一天，由用户的时区决定
    @Expect(DTO.String().pattern(/^\d{4}-\d{2}-\d{2}$/, 'day').required())
    public spentOn: string
}

/**
 * 一个月份，格式为 YYYY-MM
 */
export class MonthDTO extends DTO {
    @Expect(DTO.String().pattern(/^\d{4}-(0[1-9]|1[0-2])$/, 'month').required())
    public month: string
}
```

每个动作运行前都先用 DTO 校验输入（见 [DTOValidation](../DTOValidation.md)）。消息是 JSON，值会保留原来的类型：`amount` 必须是整数，`12.5` 会被拒绝，报错 `"amount" must be an integer`。日期是设备上的日期，由用户界面给出：今天是哪一天，不由 Node.js 端替用户决定。

## 5. 异常

**`packages/app/src/exceptions/ExpenseNotFoundException.ts`**

```typescript
import {Exception} from 'lakutata'

/**
 * 请求的支出不存在
 */
export class ExpenseNotFoundException extends Exception {
    public errno: string = 'E_EXPENSE_NOT_FOUND'
}
```

异常带有 `errno`，用户界面根据这个代码判断错误（见 [Exceptions](../Exceptions.md)）。用户界面收到的错误和抛出时一样，带有全部属性：`ipc.invoke()` 返回的 Promise 会以这个错误拒绝。

## 6. 控制器

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
 * 一个月的支出：总额、每个分类的合计（最大的在前），以及各笔支出（最新的在前）
 */
export type MonthSummary = { month: string, total: number, categories: { category: string, total: number }[], expenses: Expense[] }

/**
 * 支出的动作，由用户界面调用：ipc.invoke({cmd: 'expenses.month', month: '2026-11'})
 */
export class ExpenseController extends Controller {

    /**
     * 向客户端推送事件：用户界面（ipc.on），以及开发时的工具（GET /events）
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
        //这个月份有变化
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

- 每个 `@ServiceAction` 由一条消息调用（见 [ServiceCalls](../ServiceCalls.md) 第 2 节）：用户界面用 `ipc.invoke({cmd: 'expenses.month', month: '2026-11'})` 发送消息，经由原生模块及其套接字到达 Node.js。
- `this.entrypoint.broadcast()` 向所有客户端推送 `expenses.changed`：包括用户界面，以及开发时的工具（见第 10 节）。参数是有变化的月份，所以正在显示其他月份的用户界面不用重新加载。
- `Like` 来自 `lakutata/orm`，即 TypeORM 的 API（见 [Database](../Database.md)）。

## 7. 应用的选项

**`packages/app/src/config/Config.ts`**

```typescript
import type {Duplex} from 'node:stream'
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
     * 向用户界面提供动作的宿主：'native' 表示手机应用的原生模块（LAKUTATA_NODE_FD 的套接字），也可以是代替它的套接字（测试中）；
     * 在开发用的电脑上没有
     */
    host?: 'native' | Duplex
    /**
     * 开发用的 HTTP 入口的端口，默认没有。工具（Postman、curl）用 POST / 和消息（模式和输入）调用动作，用 GET /events
     * 接收推送给它们的事件（Server-Sent Events），并在 id 请求头（或 id 查询参数）中给出客户端 id
     */
    devPort?: number
}

/**
 * 应用的选项：App.ts 交给 run() 的函数会调用它
 * @param options
 */
export function config(options: ConfigOptions = {}): ApplicationOptions {
    return {
        id: 'expenses',
        name: 'expenses',
        mode: options.mode ?? 'development',
        components: {
            //支出数据，放在应用的数据目录（@data）中
            database: buildDatabaseOptions({
                type: 'better-sqlite3',
                database: '@data/expenses.sqlite',
                entities: [Expense],
                //迁移随应用的单文件包一起发布；数据库还没执行过的迁移会在连接时执行，所以应用更新后，设备上的数据库也随之更新
                migrations: [Migrations1793722916138],
                migrationsRun: true
            }),
            entrypoint: buildEntrypoints({
                controllers: [ExpenseController],
                //用户界面通过原生模块调用动作：ipc.invoke({cmd: 'expenses.month', month: '2026-11'})
                service: [
                    ...options.host === undefined ? [] : [reactNativeServiceEntrypoint(options.host === 'native' ? {} : {socket: options.host})],
                    ...options.devPort === undefined ? [] : [httpServiceEntrypoint({port: options.devPort})]
                ]
            })
        },
        //先连接数据库并执行迁移，再提供动作
        bootstrap: ['database', 'entrypoint']
    }
}
```

- 数据库是应用数据目录中的一个文件 `@data/expenses.sqlite`，数据库连接时会解析这个别名。模板的 `App.ts` 为每个系统声明别名 `@data`：Android 上是应用的 `files` 目录，iOS 上是 `Library/Application Support`，鸿蒙上是 `/data/storage/el2/base/files`，在电脑上是 `packages/app/data`。系统会一直保留这个目录，直到应用被卸载；`os.tmpdir()` 则是应用的缓存目录，系统可能清空它。
- 迁移以类的形式列出。在设备上，Node.js 端是一个单文件包（由 `lakutata mobile stage` 生成），里面没有 `build/migrations/*.js` 这类通配路径能找到的编译文件。`migrationsRun: true` 会在连接时执行设备上的数据库还没执行过的迁移，所以应用更新后第一次启动时，数据库就会更新到最新。
- `bootstrap` 先连接数据库并执行迁移，再提供动作。

## 8. 用户界面

**`packages/ui/src/App.tsx`**

```tsx
import {useCallback, useEffect, useState} from 'react'
import {Button, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native'
import {SafeAreaProvider, useSafeAreaInsets, type EdgeInsets} from 'react-native-safe-area-context'
import {ipc} from 'ipc'

/**
 * 一笔支出，即动作返回的格式
 */
type Expense = { id: number, amount: number, category: string, note: string, spentOn: string }

/**
 * 一个月的支出，即 expenses.month 返回的格式
 */
type MonthSummary = { month: string, total: number, categories: { category: string, total: number }[], expenses: Expense[] }

/**
 * 设备时区中的日期，格式为 YYYY-MM-DD
 * @param date
 */
function day(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * 某个月份（YYYY-MM）的前一个月或后一个月
 * @param month
 * @param offset
 */
function shift(month: string, offset: number): string {
    const [year, index] = month.split('-').map(Number)
    return day(new Date(year, index - 1 + offset, 1)).slice(0, 7)
}

/**
 * 以分为单位的金额，显示为 12.50 的形式
 * @param cents
 */
function money(cents: number): string {
    return (cents / 100).toFixed(2)
}

/**
 * 应用：和模板一样，界面在设备的安全区域内
 */
export default function App() {
    return (
        <SafeAreaProvider>
            <Expenses/>
        </SafeAreaProvider>
    )
}

function Expenses() {
    //避开状态栏、摄像头和底部手势条
    const insets: EdgeInsets = useSafeAreaInsets()
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
        //添加或删除了支出：如果变化的正是当前显示的月份，就重新加载
        return ipc.on('expenses.changed', (changed: string): void => {
            if (changed === month) load()
        })
    }, [load, month])

    //Node.js 结束了（process.exit()、未捕获的异常）：手机应用会继续运行
    useEffect((): () => void => ipc.on('exit', (code: number): void => setEnded(code)), [])

    const restart = (): void => {
        setEnded(null)
        ipc.restart()
        load()
    }

    const add = (): void => {
        setFailure('')
        //把 12.5 或 12,50 换算成分
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
        //键盘显示时，点按钮也能点到（默认情况下，这一下只会收起键盘）
        <ScrollView contentContainerStyle={{paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24, paddingLeft: insets.left + 24, paddingRight: insets.right + 24}} keyboardShouldPersistTaps="handled">
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

- 和模板一样，界面在设备的安全区域内：`useSafeAreaInsets()` 给出状态栏、摄像头和底部手势条占用的空间。
- `ipc` 来自模板的 `ipc` 包：`ipc.invoke()` 调用动作，返回它的 `payload`，或者以它的错误拒绝；`ipc.on()` 监听事件，并返回移除监听器的函数。
- 收到 `expenses.changed` 时，如果变化的正是当前显示的月份，就重新加载这个月。
- `keyboardShouldPersistTaps="handled"` 让键盘显示时也能点到按钮：默认情况下，这一下只会收起键盘，输入的支出不会被添加。
- Node.js 结束时（未捕获的异常、`process.exit()`），手机应用会继续运行：`ipc` 发出 `exit`，`ipc.restart()` 重新启动 Node.js，和模板中一样。

## 9. 运行

先在单独的终端中启动 Metro，再在模拟器（或设备）上运行应用：

```bash
npm start
npm run android     # 或：npm run ios、npm run harmony
```

`npm run android` 会构建各个包，生成应用的 Node.js 项目（`lakutata mobile stage`：Node.js 端的单文件包，以及为 Android 各架构编译的 `better-sqlite3`），构建调试版应用，安装并启动它。第一次运行时，它会下载这个系统的 libnode。用户界面来自 Metro，修改后立即生效；修改 `packages/app` 后，用 `npm run deploy:android`（或 `deploy:ios`、`deploy:harmony`）把它放进已安装的应用，不需要重新安装。

添加一笔支出，关闭应用（在 Android 上，从最近使用的应用中把它划掉），再重新打开：这个月仍然列出了那笔支出，它是从数据目录中的数据库读出来的。按住一笔支出可以删除它。

## 10. 在电脑上试用

`npm run dev -w app` 在电脑上运行 Node.js 端，数据库放在 `packages/app/data` 中，并通过 HTTP 在 9000 端口（`DEV_PORT`）提供动作，供 curl 或 Postman 等工具使用：`POST /` 发送消息，`GET /events` 接收某个客户端的事件（见 [ServiceCalls](../ServiceCalls.md) 第 4 节）。

```bash
npm run dev -w app
```

在另一个终端中运行：

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

错误带有异常的全部属性，包括调用栈（这里省略了）。

## 11. 测试

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
 * 测试中的手机应用原生模块：它这一端连接应用的套接字，以及它收到的消息（每条一行 JSON）
 */
const received: ReactNativeServiceMessage[] = []
let host: Socket

let next: number = 0

/**
 * 像原生模块那样写一条消息，即一行 JSON
 * @param message
 */
function send(message: Record<string, unknown>): void {
    host.write(`${JSON.stringify(message)}\n`)
}

/**
 * 像用户界面那样调用动作（ipc.invoke）
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
 * 互相连接的两个套接字：原生模块一端和应用一端
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
    //测试用的数据目录，数据库就在这里
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
            //像 App.ts 那样声明 @data
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
        //用户界面订阅了事件，订阅得到了应答
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

测试用 Node.js 运行 Node.js 端，方式和原生模块在设备上运行它一样：一个套接字代替原生模块的套接字，测试往里写消息（每条一行 JSON：`invoke`、`subscribe`），并读取响应和事件。`@data` 是一个临时目录，像 `App.ts` 那样声明。

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

测试使用的是为电脑上的 Node.js 安装的 `better-sqlite3`；每个系统用的版本由 `lakutata mobile stage` 编译。

## 12. 发布

三个系统的发布版由各自的原生项目构建：它们把用户界面打包进应用，而不是从 Metro 加载，并且要为各自的应用商店签名。项目 README 的“The packaging”一节给出了构建命令；先用 `npm run stage:android`（或 `stage:ios`、`stage:harmony`）生成 Node.js 项目。调试版和发布版中的 Node.js 端完全相同，数据目录和迁移也一样：在旧版本上安装更新会保留数据库，更新后第一次启动时执行新的迁移。

<!--
check:
  create: expenses mobile-react
  remove: packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
  run: npm test
-->
