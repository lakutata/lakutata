# A command line tool

This example builds `tally`, a command line tool for CSV files: it lists the columns of a file, computes the statistics
of a numeric column, and converts the rows to JSON. It starts from the `cli` template and shows the parts of a lakutata
tool: the commands with their arguments and options (`@CLIAction` and its DTO), input validation, asking for a missing
option in the terminal, output and exit codes, the tests, and a bundle that runs without `node_modules`.

| Command | What it does |
|---|---|
| `tally columns <file>` | Lists the columns of the file, with the type and the number of values of each |
| `tally stats <file> --column <name>` | Gives the count, the sum, the minimum, the maximum, the mean and the median of a numeric column |
| `tally json <file>` | Converts the rows to JSON: all the columns or only some, with the numbers kept as text or written as numbers |

## 1. Create the project

```bash
npx @lakutata/cli create --name tally --template cli --yes
cd tally
rm packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
```

The project is a workspace whose tool is `packages/app` ([ProjectStructure](../ProjectStructure.md)). Its dependencies
are already there: `commander`, which reads the command line, and `@inquirer/prompts`, which asks the questions in a
terminal. The tool reads the CSV files with a small parser of its own, so nothing else is installed. The example
command of the template and its DTO are removed.

## 2. The input

**`packages/app/src/dtos/CsvDTO.ts`**

```typescript
import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

/**
 * A CSV file: <file> [--delimiter <value>]
 */
export class FileDTO extends DTO {
    @Expect(DTO.String().required().description('The CSV file'))
    public file: string

    @Expect(DTO.String().length(1).default(',').description('The character between the values'))
    public delimiter: string
}

/**
 * The statistics of a column: --column <value> [--decimals <value>] [--format <value>]
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
 * The conversion to JSON: [--columns <values...>] [--numbers] [--limit <value>]
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

Each command takes a DTO, whose properties are its arguments and its options ([CLI](../CLI.md)):

- `file` is named in the commands (`'stats <file>'`), so it is an argument. The other properties are options of the
  same name: `--delimiter`, `--column`, `--decimals`…
- The type of a property decides the form of its option: `--decimals 3` for a number, `--numbers` for a boolean (a
  flag), `--columns product units` for an array.
- The help shows the `.description()` of each property, its default and its allowed values (`.valid()`).
- The command line is text: the adapter converts each value to the type of its property before the DTO validates the
  input ([DTOValidation](../DTOValidation.md)), so the numbers need no `.strict(false)`.
- `StatsDTO` and `JsonDTO` extend `FileDTO`: every command takes the file and the delimiter.
- `column` is required and has no default: in a terminal, the tool asks for it when it is missing (section 7).

## 3. The exception

**`packages/app/src/exceptions/CsvException.ts`**

```typescript
import {Exception} from 'lakutata'

/**
 * A CSV file that cannot be read, or a column that cannot be used
 */
export class CsvException extends Exception {
    public errno: string = 'E_CSV'
}
```

Errors in a file or in its columns are `CsvException`s ([Exceptions](../Exceptions.md)). The message is a template,
filled in from the values given when the exception is thrown:
`new CsvException('The file {file} does not exist', {file: file})`. On the command line, a failed command writes
`error:` and the message, and exits with code 1.

## 4. Reading a CSV file

**`packages/app/src/lib/Csv.ts`**

```typescript
import {readFile} from 'node:fs/promises'
import {CsvException} from '../exceptions/CsvException.js'

/**
 * A CSV file: its columns, named by its first line, and its rows, each holding one value per column
 */
export type CsvTable = {
    columns: string[]
    rows: Record<string, string>[]
}

/**
 * The lines of a CSV text, each a list of values. A value in double quotes may hold the delimiter, line breaks and
 * doubled quotes ("")
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
            //A line ends with \n or \r\n
            if (character === '\r' && text[index + 1] === '\n') index++
            lines.push([...line, value])
            line = []
            value = ''
        } else {
            value += character
        }
    }
    //The last line, when the text does not end with a line break
    if (line.length || value) lines.push([...line, value])
    return lines
}

/**
 * Read a CSV file
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
    //The blank lines are skipped
    const [columns, ...lines] = parseCsv(text, delimiter).filter((line: string[]): boolean => line.join('') !== '')
    if (!columns) throw new CsvException('The file {file} is empty', {file: file})
    const rows: Record<string, string>[] = lines.map((line: string[], index: number): Record<string, string> => {
        if (line.length !== columns.length) throw new CsvException('The row {row} of {file} has {count} values, not {expected}', {row: index + 1, file: file, count: line.length, expected: columns.length})
        return Object.fromEntries(columns.map((column: string, position: number): [string, string] => [column, line[position]]))
    })
    return {columns: columns, rows: rows}
}

/**
 * Whether a value is a number
 * @param value
 */
export function isNumber(value: string): boolean {
    return value.trim() !== '' && Number.isFinite(Number(value))
}
```

These are plain functions, not objects in the container: the commands call them directly.

- `parseCsv()` splits the text into lines and values as RFC 4180 describes them: a value in double quotes may hold the
  delimiter, line breaks and doubled quotes, and the lines end with `\n` or `\r\n`.
- `readCsv()` takes the names of the columns from the first line and skips the blank lines. A file that does not
  exist, an empty file, or a row with more or fewer values than columns is a `CsvException`; other file system errors
  (a directory, a file it may not read) are thrown as they are.

## 5. The commands

**`packages/app/src/controllers/CsvController.ts`**

```typescript
import {Controller} from 'lakutata/com/entrypoint'
import {CLIAction} from 'lakutata/decorator/ctrl'
import {FileDTO, JsonDTO, StatsDTO} from '../dtos/CsvDTO.js'
import {CsvException} from '../exceptions/CsvException.js'
import {type CsvTable, isNumber, readCsv} from '../lib/Csv.js'

/**
 * The statistics of a column
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
     * Check that the columns are in the file
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
     * tally columns sales.csv: the columns, with the type and the number of values of each
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
     * tally stats sales.csv --column units: the count, the sum, the minimum, the maximum, the mean and the median
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
        //An object is written as JSON, a string as it is
        if (input.format === 'json') return stats
        return Object.entries(stats).map(([name, value]: [string, string | number]): string => `${name.padEnd(6)}  ${value}`).join('\n')
    }

    /**
     * tally json sales.csv --columns product units --numbers --limit 2: the rows, as an array of objects
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

- Each `@CLIAction` declares a command: its name and its arguments (`'stats <file>'`), its DTO, and its
  `description`, the line that the help shows for the command ([Controllers](../Controllers.md)).
- The action receives the validated input, with the defaults applied: `delimiter` is `','` and `decimals` is 2 when
  they are not given.
- What it returns is written to stdout: a string as it is (`columns`, and `stats` by default), any other value as
  indented JSON (`stats --format json`, `json`).
- A thrown exception is the error of the command.

## 6. The options of the tool

**`packages/app/src/config/Config.ts`**

```typescript
import type {ApplicationOptions} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {commanderCLIEntrypoint} from 'lakutata/adapter/commander'
import manifest from '../../package.json' with {type: 'json'}
import {CsvController} from '../controllers/CsvController.js'

/**
 * The options of the tool
 */
export function config(): ApplicationOptions {
    return {
        id: 'tally',
        name: 'tally',
        components: {
            entrypoint: buildEntrypoints({
                controllers: [CsvController],
                //The actions of the controllers are the commands; the missing required options are asked for in a terminal
                cli: commanderCLIEntrypoint({bin: 'tally', description: 'Statistics of CSV files, and their conversion to JSON', version: manifest.version})
            })
        },
        bootstrap: ['entrypoint']
    }
}
```

This is the `Config.ts` of the template, with `CsvController` instead of the example controller. The description of
the tool is written here, whereas the template reads it from `packages/app/package.json`, where
`lakutata create --description` puts it; the version still comes from that file. `bin` is the name of the tool in the
help.

## 7. Run it

Build the tool, and save a CSV file at the root of the project:

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

The commands below run the built tool with node; `npm link -w app` would install it as the command `tally`.

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

`--delimiter ';'` reads the files whose values are separated by semicolons, and `--delimiter $'\t'` the TSV files.

**A question for a missing option.** In a terminal, the tool asks for a missing required option. The question is the
description of the property followed by its name. The answer, `price` here, is checked against the rules of the
property, and the question is asked again if the answer is invalid:

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

The tool asks only when its stdin and its stdout are both a terminal. In a script or a pipe, it asks nothing, and the
missing option is an error:

```text
$ node packages/app/build/App.js stats sales.csv < /dev/null
error: required option '--column <value>' not specified
```

**Errors and exit codes.** Invalid input is refused at one of three steps. Each step writes `error:` and a message to
stderr, and the tool exits with code 1:

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

- The command line parser refuses what does not fit the command, before the DTO sees it: text instead of a number, a
  value outside `.valid()`, a missing argument or option, an unknown command.
- The DTO refuses a value that breaks its other rules, such as `.max(6)`.
- The action refuses what only it can check, with an exception: a file that does not exist, a column that does not
  hold numbers.

A command that succeeds exits with code 0, as do `--help` and `--version`, so scripts can test the result of each
command.

## 8. Test it

The test of the template is replaced by a test of the commands. As in the template, it runs the built tool in a child
process, here with a CSV file written to a temporary directory. The stdin of the child is not a terminal, so the tool
asks nothing:

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
 * The compiled tool
 */
const TOOL: string = fileURLToPath(new URL('../App.js', import.meta.url))

/**
 * Run the tool with arguments (its stdin is not a terminal: it asks for nothing)
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

    //A CSV file in a temporary directory: a quoted value holding a comma, an empty value, Windows line breaks
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

## 9. One file to ship

```bash
npm run package:bundle
```

```
✔ ../../dist/tally.cjs (1.1 MB): node ../../dist/tally.cjs
```

The script builds the tool, then `lakutata package bundle` writes it, with lakutata, commander and
`@inquirer/prompts`, into one JavaScript file: `dist/tally.cjs` at the root of the project (the printed path is
relative to `packages/app`, where the script runs). Node.js runs it from any directory, without `node_modules`; here,
from a directory next to the project:

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

- The bundle is a CommonJS file, so the sources cannot use top-level `await`.
- `npm run package:exe` makes `dist/tally`, an executable that runs without Node.js installed: Node.js is embedded in
  it (about 110 MB). It runs on the platform it is made on; the README of the project shows how to make it for the
  other platforms ([Packaging](../Packaging.md)).
- The `installer` feature of the template (`lakutata create --with installer`) makes the installers, the packages of
  each system (deb, rpm, pkg, msi…) that put `tally` in the PATH ([Installers](../Installers.md)).

<!--
check:
  create: tally cli
  remove: packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
  run: npm test
  run: npm run package:bundle
  run: node dist/tally.cjs stats sales.csv --column units
-->
