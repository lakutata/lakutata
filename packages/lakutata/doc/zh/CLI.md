# Lakutata 命令行

命令行适配器将控制器中标注了 `@CLIAction` 的动作转换为命令行工具的命令，底层基于 [Commander](https://github.com/tj/commander.js)。除 `lakutata` 外，还需安装 `commander`（12 到 15 版）；如果希望工具在缺少输入时向用户提问，还需安装 `@inquirer/prompts`（7 或 8 版）：

```bash
npm install commander @inquirer/prompts
```

## 1. 第一个命令行工具

```typescript
import {Application, DTO} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {CLIAction} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {commanderCLIEntrypoint} from 'lakutata/adapter/commander'

class GreetDTO extends DTO {
    @Expect(DTO.String().required().description('The name to greet'))
    public name: string

    @Expect(DTO.Number().integer().min(1).default(1).description('How many times'))
    public times: number

    @Expect(DTO.Boolean().default(false).description('Greet in capitals'))
    public loud: boolean
}

class ToolController extends Controller {
    @CLIAction('greet <name>', GreetDTO, {description: 'Greet someone'})
    public async greet(input: GreetDTO): Promise<string> {
        const text: string = `Hello, ${input.name}`
        return Array(input.times).fill(input.loud ? text.toUpperCase() : text).join('\n')
    }
}

Application.run(() => ({
    id: 'tool.app',
    name: 'Tool',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [ToolController],
            cli: commanderCLIEntrypoint({bin: 'tool', description: 'A small tool', version: '1.0.0'})
        })
    },
    bootstrap: ['entrypoint']
}))
```

```text
$ node dist/index.js greet Ada --times 2 --loud
HELLO, ADA
HELLO, ADA
```

运行过程如下：

1. 应用启动。入口必须列在 `bootstrap` 中，否则不会有任何对象创建入口，任何命令都不会执行。
2. 应用启动完成后（`bootstrap` 中的对象均已创建，其他适配器也已启动），适配器读取命令行并执行对应的动作。
3. 结果写入 stdout，错误写入 stderr。
4. 应用随后停止，进程退出。命令成功时退出码为 0，失败时为 1。

`bin` 是帮助信息中显示的程序名。未设置时，适配器取脚本文件名，例如 `node dist/index.js` 对应的程序名为 `index`。

## 2. 命令与参数

`@CLIAction(command, DTO?, options?)`（来自 `lakutata/decorator/ctrl`）声明一个命令。`command` 字符串由命令名及其位置参数组成，写法与 Commander 相同：

| 写法 | 含义 |
|---|---|
| `<name>` | 必填参数 |
| `[name]` | 可选参数 |
| `<files...>` | 一个或多个参数，收集为数组（`[files...]` 表示零个或多个） |

每个参数按同名 DTO 属性的类型转换后赋给该属性。多余的参数会导致报错。

**分组。** 命令名之前的词为分组。`@CLIAction('file copy <files...>', CopyDTO)` 是分组 `file` 下的命令 `copy`，通过 `tool file copy a.txt b.txt` 执行。分组可以嵌套（`'pack linux deb'`）。适配器的 `groups` 选项为分组提供说明，`tool file --help` 会列出分组下的命令。以下是一个包含命令 `greet` 和分组 `file` 的工具的帮助：

```text
$ tool --help
Usage: tool [options] [command]

A small tool

Options:
  -V, --version           output the version number
  -h, --help              display help for command

Commands:
  greet [options] <name>  Greet someone
  file                    Work on files
  help [command]          display help for command
```

**帮助文字。** 动作选项 `description` 是命令在帮助中的说明。未设置时，帮助中显示动作名（`ToolController:greet`）。

**前缀。** 在控制器上添加 `@Prefix({command: 'user'})` 后，前缀会以冒号连接在该控制器每个命令的前面，例如 `@CLIAction('get <id>')` 变为 `tool user:get 42`。前缀是命令名的一部分，而非分组。

## 3. 选项

DTO 的其他属性均为选项。选项名是属性名的短横线形式（`keepTimes` 对应 `--keep-times`），选项的形式由属性的类型决定：

| 属性类型 | 选项形式 | 示例 |
|---|---|---|
| 布尔值 | 开关 | `--loud` |
| 默认值为 `true` 的布尔值 | 开关及其反向开关 | `--keep-times`、`--no-keep-times` |
| `DTO.Alternatives(DTO.Boolean(), …)` | 可带值的开关 | `--color`、`--color always` |
| 数字 | 一个数字 | `--times 2` |
| 数组 | 一个或多个值，重复指定同一选项时也会累加 | `--ports 80 443` |
| 对象 | 一个 JSON 值 | `--filter '{"active":true}'` |
| 其他 | 一个字符串 | `--mode fast` |

帮助中会显示每个属性的 `.description()`、默认值和允许的取值（`.valid()`）。不在允许范围内的取值，以及应为数字却不是数字的取值，都会在动作执行前被拒绝：

```text
$ tool file copy --help
Usage: tool file copy [options] <files...>

Copy files

Options:
  --mode <value>       The copy mode (choices: "fast", "safe", default: "safe")
  --keep-times         Keep the timestamps (default: true)
  --no-keep-times      Turn off --keep-times
  --ports <values...>  The ports
  -h, --help           display help for command

$ tool file copy a.txt --mode slow
error: option '--mode <value>' argument 'slow' is invalid. Allowed choices are "fast", "safe".
```

- 没有默认值的必填属性必须给出，除非工具会向用户提问（见第 5 节）。
- 选项没有 `-m` 这样的短写形式。
- 没有 DTO 的命令不接受任何选项，其参数以字符串形式交给动作。

随后 DTO 会像校验其他动作一样校验输入，并补全默认值、去除未知的键（见 [DTO 校验](DTOValidation.md)）。

## 4. 输出与退出码

动作的返回值写入 stdout：

| 返回值 | 输出 |
|---|---|
| 字符串 | 原样输出，末尾没有换行时补充一个换行 |
| `null`、`undefined` | 不输出任何内容 |
| `Uint8Array`（`Buffer`） | 原样输出字节 |
| 其他值 | 带缩进的 JSON |
| `Result.file(path)`（也可以是 `Buffer` 或流） | 文件内容 |
| `Result.events(producer)` | 每个事件的数据，事件发送后立即写出 |
| `Result.status(status, data)` | 只输出数据 |

`Result` 来自 `lakutata/com/entrypoint`。`format` 选项可以替换这套格式。该选项接收每个结果（以及每个事件），返回字符串或字节，或者返回 `undefined` 表示不输出。

各种情况下的输出位置和退出码：

| 情况 | 输出 | 退出码 |
|---|---|---|
| 命令成功 | 结果写入 stdout | 0 |
| 动作、中间件、校验或访问控制失败 | stderr 上的 `error: <消息>` | 1 |
| 命令不存在、缺少参数、取值不合法、参数多余 | stderr 上 Commander 的提示 | 1 |
| `--help`、`--version` | stdout | 0 |
| 未给出任何命令 | 帮助写入 stderr | 1 |

```text
$ tool greet
error: missing required argument 'name'
$ tool greet Ada --times x
error: option '--times <value>' argument 'x' is invalid. Not a number.
```

在动作中，`this.context` 是一个 `CLIContext`。其 `command` 是声明时的命令（含前缀，例如 `'user:get <id>'`），`data` 是从命令行读取的参数和选项（尚未校验）。

## 5. 提示输入

工具在终端中运行且已安装 `@inquirer/prompts` 时，缺少的值会改为向用户提问，而不是直接报错。工具会依次询问每个既没有值、也没有默认值的必填属性。缺少的必填位置参数（`<name>`）不会询问，而是直接报错。

| 属性 | 提问方式 |
|---|---|
| 布尔值 | 是 / 否 |
| 有允许取值（`.valid()`） | 从列表中选择一项 |
| 由允许取值组成的数组 | 多选框 |
| 数字 | 输入数字 |
| 名称类似密码、密钥、令牌、API key 或凭据 | 隐藏输入，显示为 `*` |
| 其他 | 输入文本；数组以逗号分隔，对象写为 JSON |

每个回答都会立即按该属性的校验规则检查，不合法时显示错误并重新提问。问题的文字为属性的 `.description()`，其后接属性名。

`interactive` 选项决定何时提问：

- `'auto'`（默认）：仅当 stdin 和 stdout 都是终端时才提问。在脚本中通过管道输入或输出时，缺少的值直接报错，而不是等待回答。
- `true`：始终提问（前提是已安装 `@inquirer/prompts`）。
- `false`：从不提问。

## 6. 适配器的选项

| 选项 | 默认值 | 含义 |
|---|---|---|
| `bin` | 脚本文件名 | 帮助中显示的程序名 |
| `description` | | 帮助中显示的程序说明 |
| `version` | | 添加 `-V, --version`，输出该版本号 |
| `groups` | | 分组的说明：`{file: 'Work on files', 'pack linux': 'Linux packages'}` |
| `argv` | `process.argv.slice(2)` | 要读取的参数 |
| `interactive` | `'auto'` | 何时向用户提问（见第 5 节） |
| `stdin`、`stdout`、`stderr` | 进程的标准流 | 提问的输入来源，以及结果和错误的输出位置 |
| `format` | 见第 4 节 | 将结果转换为要输出的文本或字节 |
| `noCommand` | `'help'` | 没有参数时的行为：`'help'` 输出帮助并以退出码 1 退出，`'ignore'` 不执行任何操作，应用继续运行 |
| `exit` | `'application'` | 命令执行完毕后的行为：`'application'` 停止应用并以命令的退出码退出，`'process'` 只设置 `process.exitCode`，`'none'` 不执行任何操作，传入函数时由函数接收退出码 |
| `configure` | | `(program) => void`，在添加命令之后、读取参数之前，以 Commander 的 program 调用，可用于添加全局选项和钩子 |
| `translate` | | 翻译帮助和提问，见[国际化（i18n）](I18n.md#命令行程序的帮助和提示) |
| `middlewares` | | 仅用于该适配器命令的中间件，在入口的中间件之后执行 |
| `name` | | 适配器的名称，用于区分多个适配器 |

## 7. 服务端应用里的命令

一个应用可以同时提供 HTTP 服务和命令。但默认情况下，命令行适配器执行完命令后便会停止应用，没有参数时则输出帮助并退出。如果希望不带参数运行时启动服务、带命令运行时执行命令，请设置 `noCommand: 'ignore'`：

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {CLIAction, GET} from 'lakutata/decorator/ctrl'
import {commanderCLIEntrypoint} from 'lakutata/adapter/commander'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'

class AppController extends Controller {
    @GET('/hello')
    public async hello(): Promise<string> {
        return 'Hello'
    }

    @CLIAction('migrate', {description: 'Migrate the database'})
    public async migrate(): Promise<string> {
        return 'Migrated'
    }
}

Application.run(() => ({
    id: 'shop.app',
    name: 'Shop',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [AppController],
            cli: commanderCLIEntrypoint({bin: 'shop', noCommand: 'ignore'}),
            http: expressHTTPEntrypoint({port: 8080})
        })
    },
    bootstrap: ['entrypoint']
}))
```

`node dist/index.js` 启动服务并持续运行；`node dist/index.js migrate` 在服务启动后执行命令，随后停止应用。
