# 命令行工具

这个示例构建一个处理 CSV 文件的命令行工具 `tally`：列出文件中的列，统计某个数值列，把各行转换为 JSON。它从 `cli` 模板开始，展示 lakutata 命令行工具的各个部分：带参数和选项的命令（`@CLIAction` 及其 DTO）、输入校验、在终端中询问缺少的选项、输出与退出码、测试，以及不需要 `node_modules` 就能运行的单文件包。

| 命令 | 作用 |
|---|---|
| `tally columns <file>` | 列出文件中的列，以及每列的类型和值的个数 |
| `tally stats <file> --column <name>` | 给出数值列的个数、总和、最小值、最大值、平均值和中位数 |
| `tally json <file>` | 把各行转换为 JSON：可以选全部列或部分列，数字可以保留为文本，也可以输出为数字 |

## 1. 创建项目

```bash
npx @lakutata/cli create --name tally --template cli --yes
cd tally
rm packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
```

项目是一个工作区，工具在 `packages/app` 中（见 [ProjectStructure](../ProjectStructure.md)）。需要的依赖模板里都有：`commander` 负责读取命令行，`@inquirer/prompts` 负责在终端中提问。CSV 文件由工具自带的一个小解析器读取，所以不用再安装别的包。这里删掉了模板中的示例命令和它的 DTO。

## 2. 输入

**`packages/app/src/dtos/CsvDTO.ts`**

```typescript
import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

/**
 * 一个 CSV 文件：<file> [--delimiter <value>]
 */
export class FileDTO extends DTO {
    @Expect(DTO.String().required().description('The CSV file'))
    public file: string

    @Expect(DTO.String().length(1).default(',').description('The character between the values'))
    public delimiter: string
}

/**
 * 一列的统计：--column <value> [--decimals <value>] [--format <value>]
 */
export class StatsDTO extends FileDTO {
    @Expect(DTO.String().required().description('The column to summarize'))
    public column: string

    @Expect(DTO.Number().integer().min(0).max(6).default(2).description('The decimals of the results'))
    public decimals: number

    @Expect(DTO.String().valid('text', 'json').default('text').description('The output'))
    public format: 'text' | 'json'
}

/**
 * 转换为 JSON：[--columns <values...>] [--numbers] [--limit <value>]
 */
export class JsonDTO extends FileDTO {
    @Expect(DTO.Array(DTO.String()).min(1).optional().description('The columns to keep, all of them by default'))
    public columns?: string[]

    @Expect(DTO.Boolean().default(false).description('Write the numeric values as numbers'))
    public numbers: boolean

    @Expect(DTO.Number().integer().min(1).optional().description('The number of rows, all of them by default'))
    public limit?: number
}
```

每个命令都有一个 DTO，DTO 的属性就是命令的参数和选项（见 [CLI](../CLI.md)）：

- `file` 写在命令里（`'stats <file>'`），所以它是参数。其他属性都是选项，以属性名命名：`--delimiter`、`--column`、`--decimals`……
- 选项的形式由属性的类型决定：数字写成 `--decimals 3`，布尔值是开关 `--numbers`，数组写成 `--columns product units`。
- 帮助中会显示每个属性的 `.description()`、默认值和允许的取值（`.valid()`）。
- 命令行上都是文本：适配器先把每个值转换为对应属性的类型，再交给 DTO 校验（见 [DTOValidation](../DTOValidation.md)），所以数字不需要 `.strict(false)`。
- `StatsDTO` 和 `JsonDTO` 继承自 `FileDTO`：每个命令都接受文件和分隔符。
- `column` 是必填的，也没有默认值：在终端中运行时如果缺少这个选项，工具会提问（见第 7 节）。

## 3. 异常

**`packages/app/src/exceptions/CsvException.ts`**

```typescript
import {Exception} from 'lakutata'

/**
 * 无法读取的 CSV 文件，或无法使用的列
 */
export class CsvException extends Exception {
    public errno: string = 'E_CSV'
}
```

文件和列的错误都用 `CsvException` 表示（见 [Exceptions](../Exceptions.md)）。异常的消息是一个模板，抛出时用传入的值填充：`new CsvException('The file {file} does not exist', {file: file})`。在命令行上，失败的命令会输出 `error:` 加上这条消息，并以退出码 1 结束。

## 4. 读取 CSV 文件

**`packages/app/src/lib/Csv.ts`**

```typescript
import {readFile} from 'node:fs/promises'
import {CsvException} from '../exceptions/CsvException.js'

/**
 * 一个 CSV 文件：列名取自第一行，每一行按列名存放各自的值
 */
export type CsvTable = {
    columns: string[]
    rows: Record<string, string>[]
}

/**
 * 把 CSV 文本拆成行，每行是一组值。双引号里的值可以包含分隔符、换行和连续两个双引号（""）
 * @param text
 * @param delimiter
 */
export function parseCsv(text: string, delimiter: string): string[][] {
    const lines: string[][] = []
    let line: string[] = []
    let value: string = ''
    let quoted: boolean = false
    for (let index: number = 0; index < text.length; index++) {
        const character: string = text[index]
        if (quoted) {
            if (character !== '"') value += character
            else if (text[index + 1] === '"') value += text[++index]
            else quoted = false
        } else if (character === '"') {
            quoted = true
        } else if (character === delimiter) {
            line.push(value)
            value = ''
        } else if (character === '\n' || character === '\r') {
            //行以 \n 或 \r\n 结尾
            if (character === '\r' && text[index + 1] === '\n') index++
            lines.push([...line, value])
            line = []
            value = ''
        } else {
            value += character
        }
    }
    //文本末尾没有换行时，补上最后一行
    if (line.length || value) lines.push([...line, value])
    return lines
}

/**
 * 读取 CSV 文件
 * @param file
 * @param delimiter
 */
export async function readCsv(file: string, delimiter: string): Promise<CsvTable> {
    let text: string
    try {
        text = await readFile(file, 'utf8')
    } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new CsvException('The file {file} does not exist', {file: file})
        throw error
    }
    //跳过空行
    const [columns, ...lines] = parseCsv(text, delimiter).filter((line: string[]): boolean => line.join('') !== '')
    if (!columns) throw new CsvException('The file {file} is empty', {file: file})
    const rows: Record<string, string>[] = lines.map((line: string[], index: number): Record<string, string> => {
        if (line.length !== columns.length) throw new CsvException('The row {row} of {file} has {count} values, not {expected}', {row: index + 1, file: file, count: line.length, expected: columns.length})
        return Object.fromEntries(columns.map((column: string, position: number): [string, string] => [column, line[position]]))
    })
    return {columns: columns, rows: rows}
}

/**
 * 判断一个值是不是数字
 * @param value
 */
export function isNumber(value: string): boolean {
    return value.trim() !== '' && Number.isFinite(Number(value))
}
```

这些是普通函数，不是容器中的对象，由命令直接调用。

- `parseCsv()` 按 RFC 4180 的规则把文本拆成行和值：双引号里的值可以包含分隔符、换行和连续两个双引号，行以 `\n` 或 `\r\n` 结尾。
- `readCsv()` 用第一行作为列名，并跳过空行。文件不存在、文件为空、某一行的值个数和列数对不上，都会抛出 `CsvException`；文件系统的其他错误（比如给的是目录，或者没有读权限）原样抛出。

## 5. 命令

**`packages/app/src/controllers/CsvController.ts`**

```typescript
import {Controller} from 'lakutata/com/entrypoint'
import {CLIAction} from 'lakutata/decorator/ctrl'
import {FileDTO, JsonDTO, StatsDTO} from '../dtos/CsvDTO.js'
import {CsvException} from '../exceptions/CsvException.js'
import {type CsvTable, isNumber, readCsv} from '../lib/Csv.js'

/**
 * 一列的统计结果
 */
export type ColumnStats = {
    column: string
    count: number
    empty: number
    sum: number
    min: number
    max: number
    mean: number
    median: number
}

export class CsvController extends Controller {

    /**
     * 检查这些列是否都在文件中
     * @param table
     * @param file
     * @param columns
     */
    protected checkColumns(table: CsvTable, file: string, columns: string[]): void {
        for (const column of columns) {
            if (!table.columns.includes(column)) throw new CsvException('The column "{column}" is not in {file}: {columns}', {column: column, file: file, columns: table.columns.join(', ')})
        }
    }

    /**
     * tally columns sales.csv：列出各列，以及它们的类型和值的个数
     * @param input
     */
    @CLIAction('columns <file>', FileDTO, {description: 'List the columns of a CSV file'})
    public async columns(input: FileDTO): Promise<string> {
        const table: CsvTable = await readCsv(input.file, input.delimiter)
        const width: number = Math.max(...table.columns.map((column: string): number => column.length))
        return table.columns.map((column: string): string => {
            const values: string[] = table.rows.map((row: Record<string, string>): string => row[column]).filter((value: string): boolean => value !== '')
            const type: string = values.length && values.every(isNumber) ? 'number' : 'text'
            const empty: number = table.rows.length - values.length
            return `${column.padEnd(width)}  ${type.padEnd(6)}  ${values.length} values${empty ? `, ${empty} empty` : ''}`
        }).join('\n')
    }

    /**
     * tally stats sales.csv --column units：个数、总和、最小值、最大值、平均值和中位数
     * @param input
     */
    @CLIAction('stats <file>', StatsDTO, {description: 'Compute the statistics of a numeric column'})
    public async stats(input: StatsDTO): Promise<string | ColumnStats> {
        const table: CsvTable = await readCsv(input.file, input.delimiter)
        this.checkColumns(table, input.file, [input.column])
        const values: number[] = []
        table.rows.forEach((row: Record<string, string>, index: number): void => {
            const value: string = row[input.column]
            if (value === '') return
            if (!isNumber(value)) throw new CsvException('The value "{value}" of the column "{column}" (row {row}) is not a number', {value: value, column: input.column, row: index + 1})
            values.push(Number(value))
        })
        if (!values.length) throw new CsvException('The column "{column}" has no values', {column: input.column})
        const sorted: number[] = [...values].sort((a: number, b: number): number => a - b)
        const middle: number = Math.floor(sorted.length / 2)
        const sum: number = values.reduce((total: number, value: number): number => total + value, 0)
        const round = (value: number): number => Number(value.toFixed(input.decimals))
        const stats: ColumnStats = {
            column: input.column,
            count: values.length,
            empty: table.rows.length - values.length,
            sum: round(sum),
            min: sorted[0],
            max: sorted[sorted.length - 1],
            mean: round(sum / values.length),
            median: round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2)
        }
        //对象输出为 JSON，字符串原样输出
        if (input.format === 'json') return stats
        return Object.entries(stats).map(([name, value]: [string, string | number]): string => `${name.padEnd(6)}  ${value}`).join('\n')
    }

    /**
     * tally json sales.csv --columns product units --numbers --limit 2：把各行输出为对象数组
     * @param input
     */
    @CLIAction('json <file>', JsonDTO, {description: 'Convert a CSV file to JSON'})
    public async json(input: JsonDTO): Promise<Record<string, string | number>[]> {
        const table: CsvTable = await readCsv(input.file, input.delimiter)
        const columns: string[] = input.columns ?? table.columns
        this.checkColumns(table, input.file, columns)
        return table.rows.slice(0, input.limit).map((row: Record<string, string>): Record<string, string | number> => {
            return Object.fromEntries(columns.map((column: string): [string, string | number] => {
                return [column, input.numbers && isNumber(row[column]) ? Number(row[column]) : row[column]]
            }))
        })
    }
}
```

- 每个 `@CLIAction` 声明一个命令：命令名和参数（`'stats <file>'`）、DTO，以及 `description`，即帮助中这个命令的说明（见 [Controllers](../Controllers.md)）。
- 动作收到的是校验后的输入，已经补上默认值：没有给出时，`delimiter` 为 `','`，`decimals` 为 2。
- 动作的返回值写到 stdout：字符串原样输出（`columns`，以及默认的 `stats`），其他值输出为带缩进的 JSON（`stats --format json`、`json`）。
- 抛出的异常就是这个命令的错误。

## 6. 工具的选项

**`packages/app/src/config/Config.ts`**

```typescript
import type {ApplicationOptions} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {commanderCLIEntrypoint} from 'lakutata/adapter/commander'
import manifest from '../../package.json' with {type: 'json'}
import {CsvController} from '../controllers/CsvController.js'

/**
 * 工具的选项
 */
export function config(): ApplicationOptions {
    return {
        id: 'tally',
        name: 'tally',
        components: {
            entrypoint: buildEntrypoints({
                controllers: [CsvController],
                //控制器的动作就是命令；在终端里运行时，缺少的必填选项会向用户提问
                cli: commanderCLIEntrypoint({bin: 'tally', description: 'Statistics of CSV files, and their conversion to JSON', version: manifest.version})
            })
        },
        bootstrap: ['entrypoint']
    }
}
```

这是模板中的 `Config.ts`，用 `CsvController` 替换了示例控制器。工具的说明直接写在这里，而模板是从 `packages/app/package.json` 读取说明的，那里的说明由 `lakutata create --description` 写入；版本号仍然来自这个文件。`bin` 是工具在帮助中显示的名字。

## 7. 运行

构建工具，并在项目根目录保存一个 CSV 文件：

```bash
npm run build
```

**`sales.csv`**

```csv
date,region,product,units,price
2026-10-01,north,"Tea, green",12,4.50
2026-10-01,south,Coffee,30,3.20
2026-10-02,north,Coffee,18,3.20
2026-10-02,east,"Tea, green",,4.50
2026-10-03,south,Cocoa,7,5.10
2026-10-03,east,Coffee,25,3.40
2026-10-04,north,Cocoa,11,5.10
```

下面的命令用 node 运行构建好的工具；执行 `npm link -w app` 后，也可以直接用 `tally` 命令。

```text
$ node packages/app/build/App.js --help
Usage: tally [options] [command]

Statistics of CSV files, and their conversion to JSON

Options:
  -V, --version             output the version number
  -h, --help                display help for command

Commands:
  columns [options] <file>  List the columns of a CSV file
  stats [options] <file>    Compute the statistics of a numeric column
  json [options] <file>     Convert a CSV file to JSON
  help [command]            display help for command

$ node packages/app/build/App.js stats --help
Usage: tally stats [options] <file>

Compute the statistics of a numeric column

Arguments:
  file                 The CSV file

Options:
  --delimiter <value>  The character between the values (default: ",")
  --column <value>     The column to summarize
  --decimals <value>   The decimals of the results (default: 2)
  --format <value>     The output (choices: "text", "json", default: "text")
  -h, --help           display help for command
```

```text
$ node packages/app/build/App.js columns sales.csv
date     text    7 values
region   text    7 values
product  text    7 values
units    number  6 values, 1 empty
price    number  7 values

$ node packages/app/build/App.js stats sales.csv --column units
column  units
count   6
empty   1
sum     103
min     7
max     30
mean    17.17
median  15

$ node packages/app/build/App.js stats sales.csv --column price --decimals 3 --format json
{
  "column": "price",
  "count": 7,
  "empty": 0,
  "sum": 29,
  "min": 3.2,
  "max": 5.1,
  "mean": 4.143,
  "median": 4.5
}

$ node packages/app/build/App.js json sales.csv --columns product units --numbers --limit 2
[
  {
    "product": "Tea, green",
    "units": 12
  },
  {
    "product": "Coffee",
    "units": 30
  }
]
```

用分号分隔值的文件可以加 `--delimiter ';'` 读取，TSV 文件则用 `--delimiter $'\t'`。

**缺少选项时提问。** 在终端中运行时如果缺少必填选项，工具会向用户提问。问题的文字是属性的说明加上属性名。回答（这里是 `price`）会按该属性的规则检查，不合法时重新提问：

```text
$ node packages/app/build/App.js stats sales.csv
✔ The column to summarize (column) price
column  price
count   7
empty   0
sum     29
min     3.2
max     5.1
mean    4.14
median  4.5
```

只有 stdin 和 stdout 都是终端时，工具才会提问。在脚本或管道中，它不会提问，缺少的选项直接报错：

```text
$ node packages/app/build/App.js stats sales.csv < /dev/null
error: required option '--column <value>' not specified
```

**错误与退出码。** 不合法的输入会在三个环节之一被拒绝。无论哪个环节，都会向 stderr 写出 `error:` 和一条消息，工具以退出码 1 结束：

```text
$ node packages/app/build/App.js stats sales.csv --column units --decimals two
error: option '--decimals <value>' argument 'two' is invalid. Not a number.
$ node packages/app/build/App.js stats sales.csv --column units --format xml
error: option '--format <value>' argument 'xml' is invalid. Allowed choices are "text", "json".
$ node packages/app/build/App.js stats sales.csv --column units --decimals 9
error: "decimals" must be less than or equal to 6
$ node packages/app/build/App.js stats sales.csv --column region
error: The value "north" of the column "region" (row 1) is not a number
$ node packages/app/build/App.js columns sale.csv
error: The file sale.csv does not exist
$ echo $?
1
```

- 命令行解析器在 DTO 之前就拒绝不符合命令格式的输入：该是数字的地方给了文本、取值不在 `.valid()` 之内、缺少参数或选项、命令不存在。
- DTO 拒绝违反其他规则的值，比如 `.max(6)`。
- 只有动作自己才能检查的问题，由动作抛出异常来拒绝：文件不存在，或者某列不全是数字。

命令成功时退出码为 0，`--help` 和 `--version` 也是如此，所以脚本可以根据退出码判断每个命令是否成功。

## 8. 测试

模板中的测试换成了针对这些命令的测试。和模板一样，它在子进程中运行构建好的工具，这里还会先在临时目录中写一个 CSV 文件。子进程的 stdin 不是终端，所以工具不会提问：

**`packages/app/src/tests/App.spec.ts`**

```typescript
import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFile, type ExecFileException} from 'node:child_process'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

/**
 * 编译后的工具
 */
const TOOL: string = fileURLToPath(new URL('../App.js', import.meta.url))

/**
 * 带参数运行工具（它的 stdin 不是终端，所以不会提问）
 * @param args
 */
function tool(...args: string[]): Promise<{ code: number, stdout: string, stderr: string }> {
    return new Promise((resolve: (result: { code: number, stdout: string, stderr: string }) => void): void => {
        execFile(process.execPath, [TOOL, ...args], (error: ExecFileException | null, stdout: string, stderr: string): void => resolve({code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: stdout, stderr: stderr}))
    })
}

describe('tally', (): void => {

    let directory: string
    let file: string

    //临时目录里的 CSV 文件：有一个带逗号的引号值、一个空值，换行用的是 Windows 的 \r\n
    before((): void => {
        directory = mkdtempSync(path.join(tmpdir(), 'tally-'))
        file = path.join(directory, 'sales.csv')
        writeFileSync(file, 'region,product,units\r\nnorth,"Tea, green",12\r\nsouth,Coffee,30\r\nnorth,Coffee,\r\neast,Cocoa,7\r\n')
    })

    after((): void => {
        rmSync(directory, {recursive: true, force: true})
    })

    it('lists the columns', async (): Promise<void> => {
        const result = await tool('columns', file)
        assert.strictEqual(result.code, 0, result.stderr)
        assert.strictEqual(result.stdout, 'region   text    4 values\nproduct  text    4 values\nunits    number  3 values, 1 empty\n')
    })

    it('computes the statistics of a column', async (): Promise<void> => {
        const result = await tool('stats', file, '--column', 'units', '--format', 'json')
        assert.strictEqual(result.code, 0, result.stderr)
        assert.deepStrictEqual(JSON.parse(result.stdout), {column: 'units', count: 3, empty: 1, sum: 49, min: 7, max: 30, mean: 16.33, median: 12})
    })

    it('converts the rows to JSON', async (): Promise<void> => {
        const result = await tool('json', file, '--columns', 'product', 'units', '--numbers', '--limit', '3')
        assert.strictEqual(result.code, 0, result.stderr)
        assert.deepStrictEqual(JSON.parse(result.stdout), [{product: 'Tea, green', units: 12}, {product: 'Coffee', units: 30}, {product: 'Coffee', units: ''}])
    })

    it('requires the column outside a terminal', async (): Promise<void> => {
        const result = await tool('stats', file)
        assert.strictEqual(result.code, 1)
        assert.strictEqual(result.stderr, `error: required option '--column <value>' not specified\n`)
    })

    it('refuses an invalid option', async (): Promise<void> => {
        const result = await tool('stats', file, '--column', 'units', '--decimals', '9')
        assert.strictEqual(result.code, 1)
        assert.strictEqual(result.stderr, 'error: "decimals" must be less than or equal to 6\n')
    })

    it('fails on a column that is not in the file', async (): Promise<void> => {
        const result = await tool('stats', file, '--column', 'price')
        assert.strictEqual(result.code, 1)
        assert.strictEqual(result.stderr, `error: The column "price" is not in ${file}: region, product, units\n`)
    })

    it('fails on a value that is not a number', async (): Promise<void> => {
        const result = await tool('stats', file, '--column', 'product')
        assert.strictEqual(result.code, 1)
        assert.strictEqual(result.stderr, 'error: The value "Tea, green" of the column "product" (row 1) is not a number\n')
    })

    it('shows its version', async (): Promise<void> => {
        const {version} = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
        assert.strictEqual((await tool('--version')).stdout.trim(), version)
    })
})
```

```bash
npm test
```

```
app │   ✔ lists the columns
app │   ✔ computes the statistics of a column
app │   ✔ converts the rows to JSON
app │   ✔ requires the column outside a terminal
app │   ✔ refuses an invalid option
app │   ✔ fails on a column that is not in the file
app │   ✔ fails on a value that is not a number
app │   ✔ shows its version
app │ ℹ pass 8
✔ test ran in app
```

## 9. 打包成一个文件

```bash
npm run package:bundle
```

```
✔ ../../dist/tally.cjs (1.1 MB): node ../../dist/tally.cjs
```

这个脚本先构建工具，再由 `lakutata package bundle` 把工具连同 lakutata、commander 和 `@inquirer/prompts` 一起打成一个 JavaScript 文件，即项目根目录下的 `dist/tally.cjs`（输出的路径相对于脚本运行的目录 `packages/app`）。Node.js 可以在任何目录中运行它，不需要 `node_modules`，比如在项目旁边的目录中：

```bash
mkdir ../tally-bundle && cp dist/tally.cjs sales.csv ../tally-bundle && cd ../tally-bundle
node tally.cjs stats sales.csv --column units --format json
```

```
{
  "column": "units",
  "count": 6,
  "empty": 1,
  "sum": 103,
  "min": 7,
  "max": 30,
  "mean": 17.17,
  "median": 15
}
```

- 单文件包是 CommonJS 文件，所以源码中不能使用顶层 `await`。
- `npm run package:exe` 生成 `dist/tally`，这是一个不需要安装 Node.js 就能运行的可执行文件：Node.js 已经嵌在里面（约 110 MB）。它只能在生成它的平台上运行，其他平台的可执行文件怎么生成，项目的 README 里有说明（见 [Packaging](../Packaging.md)）。
- 模板的 `installer` 功能（`lakutata create --with installer`）可以生成安装包，即各个系统的软件包（deb、rpm、pkg、msi 等），它们会把 `tally` 加入 PATH（见 [Installers](../Installers.md)）。
