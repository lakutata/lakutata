# @lakutata/i18n

[English](README.md) | 中文

lakutata 框架的国际化组件。它按键名保存应用在各种语言下的消息，消息使用 [ICU MessageFormat](https://unicode-org.github.io/icu/userguide/format_parse/messages/) 的语法，由 Node.js 内置的 `Intl` 按各自的语言格式化（数字、货币、日期、复数、选择），不依赖第三方库。它还提供为每个请求确定语言的中间件（这样请求的 `Translator`、校验错误和异常都使用这种语言）、Commander 命令行帮助的翻译，以及检查翻译的工具。`lakutata` 包把它重新导出为 `lakutata/com/i18n`。

## 安装

```shell
npm install lakutata
```

组件不需要其他包。`I18nMiddleware` 和 `commanderTranslator` 用到入口组件（`lakutata/com/entrypoint`，即可选的 peer 依赖 `@lakutata/entrypoint`），`lakutata` 包已经包含了它。

## 用法

### 组件和消息

用 `buildI18nOptions()` 把组件注册到应用的 `components` 中，名字为 `i18n`（中间件和 `commanderTranslator` 使用这个名字），并给出它的消息：

- `directory`：一个或多个目录（路径，或者 `@locales` 这样的应用别名），在组件创建时读取。一种语言可以是一个以语言标签命名的 JSON 文件（`en.json`、`zh-CN.json`），也可以是一个以语言标签命名的目录，目录里的文件名和子目录名作为键名的前缀（`zh-TW/order.json` 对应 `order.*`，`zh-TW/admin/user.json` 对应 `admin.user.*`）。两种布局可以混用。
- `messages`：在代码里按语言给出的消息（对象字面量或导入的 JSON），因此会和代码一起打包。它们在目录之后加入，会覆盖目录中同名的键。

JSON 的嵌套就是键名的层级：`{"order": {"count": "..."}}` 包含键 `order.count`。键名的每一段都不能包含 `.`。

```typescript
import {Application} from 'lakutata'
import {buildI18nOptions, type I18n} from 'lakutata/com/i18n'

Application
    .alias({'@locales': '/srv/shop/locales'})
    .run(() => ({
        id: 'shop.app',
        name: 'Shop',
        components: {
            i18n: buildI18nOptions({
                directory: '@locales',
                messages: {
                    'en': {order: {count: '{count, plural, =0 {No orders} one {# order} other {# orders}}', total: 'Total: {price, number, currency}'}},
                    'zh-CN': {order: {count: '{count, plural, =0 {暂无订单} other {# 个订单}}'}}
                },
                //默认语言：最后的回退语言，也是请求的语言都不支持时选用的语言
                defaultLocale: 'en',
                //zh-TW 缺少的消息依次到 zh-CN、zh、en 中查找
                fallback: {'zh-TW': 'zh-CN'},
                //消息和参数都没有给出货币时，{price, number, currency} 使用的货币
                currency: 'CNY',
                //日期和时间的时区（默认是进程的时区）
                timeZone: 'Asia/Shanghai'
            })
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const i18n: I18n = await app.getObject('i18n')
        console.log(i18n.t('order.count', {count: 1200})) //1,200 orders
        console.log(i18n.t('order.count', {count: 0}, 'zh-CN')) //暂无订单
        //zh-CN 中没有这条消息：使用英文消息，按中文格式化
        console.log(i18n.t('order.total', {price: 9.5}, 'zh-CN')) //Total: ¥9.50
    })
```

| 选项 | 默认值 | 说明 |
|---|---|---|
| `directory` | 无 | 消息所在的目录（支持别名）；后面的目录覆盖前面目录中同名的键 |
| `messages` | 无 | 在代码里按语言给出的消息，在目录之后加入 |
| `locales` | 默认语言，加上消息中出现的语言（按字母顺序） | 支持的语言，`negotiate()` 从中选择 |
| `defaultLocale` | `'en'` | 默认语言 |
| `fallback` | 无 | 某种语言缺少消息时，接着去哪些语言里找（`{'zh-TW': 'zh-CN'}`，或一个列表） |
| `missing` | `'throw'`；`NODE_ENV=production` 时为 `'key'` | `'throw'`：缺少消息、参数或货币时抛出异常；`'key'`：返回键名，把缺少的参数写成 `{name}`，把没有货币的货币参数写成普通数字，每种情况只发出一次 `I18nWarning`（按键名和语言，或者按消息和参数计） |
| `currency` | 无 | 样式和 `currency` 参数都没有给出货币时，`{price, number, currency}` 使用的 ISO 4217 货币（不设置时，这样的消息会抛出异常；`missing: 'key'` 时得到普通数字） |
| `timeZone` | 进程的时区 | 日期和时间的 IANA 时区 |
| `validationMessages` | `true` | 是否为各种语言注册内置的校验消息 |

**回退。** 某种语言里缺少的消息，依次到它的 `fallback` 语言（以及这些语言的 `fallback` 语言）、范围更宽的标签（对 `zh-Hant-TW` 来说，先 `zh-Hant`，再 `zh`）和默认语言中查找。消息总是按请求的语言格式化：德语请求用到英文消息时，数字写成 `1.000`。哪里都找不到的键会抛出 `I18nMissingKeyException`；`missing: 'key'` 时返回键名本身。

**在请求之外**（定时任务或单例组件中），使用组件的 `t(key, params, locale)`、`has(key, locale)`、`format(message, params, locale)`，以及得到某种语言翻译器的 `translator(locale)`。它们都不做语言协商：不支持的语言按原样查找，然后回退。

**运行时**，`addMessages(locale, messages)` 添加或覆盖消息。新的语言会成为支持的语言（`getLocales()`、`negotiate()`），除非 `locales` 选项已经列出了支持的语言；无论如何，它的校验消息都会像创建时一样注册。`addMessages()` 返回的 Promise 在校验消息注册完成后才完成；而 `addMessages()` 一返回，`t()` 就能取得新消息。

### 请求的翻译器

把 `I18nMiddleware` 加到入口的 `middlewares` 中，每个请求就有了自己的语言；请求中的对象（控制器、`@Scoped` 的提供者、访问控制规则）注入的是同一个使用这种语言的 `Translator`：

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import {CLIAction, GET} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'
import {buildI18nOptions, I18nMiddleware, Translator} from 'lakutata/com/i18n'

class OrderController extends Controller {
    @Inject(Translator)
    protected readonly translator: Translator

    @GET('/orders/summary')
    @CLIAction('order-summary')
    public async summary(): Promise<string> {
        const count: string = this.translator.t('order.count', {count: 3})
        const total: string = this.translator.number(1234.5, {style: 'currency', currency: 'EUR'})
        const today: string = this.translator.date(new Date(), {dateStyle: 'long'})
        return `${this.translator.locale}: ${count}, ${total}, ${today}`
    }
}

Application.run(() => ({
    id: 'shop.app',
    name: 'Shop',
    components: {
        i18n: buildI18nOptions({
            messages: {
                'en': {order: {count: '{count, plural, one {# order} other {# orders}}'}},
                'zh-CN': {order: {count: '{count} 个订单'}}
            }
        }),
        entrypoint: buildEntrypoints({
            controllers: [OrderController],
            middlewares: [I18nMiddleware],
            http: expressHTTPEntrypoint({port: 3000})
        })
    },
    bootstrap: ['entrypoint']
}))
```

翻译器（`Translator`，以及 `translator(locale)` 返回的 `ITranslator`）有 `locale`、`t(key, params)`、`has(key)`、`format(message, params)`、`number(value, options)`（`Intl.NumberFormat`）和 `date(value, options)`（`Intl.DateTimeFormat`，使用 `timeZone` 选项的时区）。没有配置中间件时，请求的 `Translator` 会抛出 `I18nTranslatorException`。

### 每个请求的语言

中间件读取请求方希望使用的语言（优先的在前），和支持的语言协商（都不匹配时用默认语言），然后设置 `context.locale`：

| 传输方式 | 读取的语言（优先的在前） |
|---|---|
| HTTP（Express、Fastify） | Query 参数 `?lang=`、Cookie `lang`，然后是 `Accept-Language`（按权重） |
| Socket.IO | 连接握手时的 Query 参数 `lang`、Cookie `lang` 和 `Accept-Language` |
| HTTP 服务适配器、JSON-RPC 适配器（HTTP、WebSocket） | HTTP 请求（WebSocket 为建立连接的请求）的 Query 参数 `lang`、Cookie `lang` 和 `Accept-Language` |
| 命令行、Electron IPC、stdio 上的 JSON-RPC | `environmentVariable` 指定的环境变量（默认没有）、`LANGUAGE`、`LC_ALL`、`LC_MESSAGES`、`LANG`，最后是进程的语言 |
| 定时任务 | 无：使用默认语言 |

不是语言标签的 Query 参数或 Cookie 值会被跳过。协商时依次尝试请求的每一种语言：先找完全相同的标签，再找只有语言部分的标签（`en-GB` 得到 `en`），再找同一语言的其他标签（`pt-PT` 得到 `pt-BR`，按支持的语言的顺序）。

子类可以换用别的组件（`@Inject('...') protected readonly i18n`），修改 `queryParameter` 和 `cookie` 的名字以及 `environmentVariable`，或者改变读取的语言（`requested(context)`）：

```typescript
import {type BaseContext} from 'lakutata/com/entrypoint'
import {I18nMiddleware} from 'lakutata/com/i18n'

export class LanguageMiddleware extends I18nMiddleware {
    protected readonly queryParameter: string = 'locale'

    protected readonly environmentVariable: string = 'SHOP_LANG'

    //优先使用登录用户保存的语言
    protected requested(context: BaseContext): string[] {
        const saved: unknown = context.data.userLanguage
        return [...(typeof saved === 'string' ? [saved] : []), ...super.requested(context)]
    }
}
```

### 消息：插值、复数和格式化

| 语法 | 例子 |
|---|---|
| 参数 | `Hello, {name}`：数字按语言格式化，`Date` 按日期格式化，其他值转为字符串 |
| 数字 | `{n, number}`、`{n, number, integer}`、`{n, number, percent}` |
| 货币 | `{price, number, currency}`（货币来自 `currency` 参数，否则来自 `currency` 选项）、`{price, number, currency/EUR}` |
| 日期、时间 | `{at, date, short}`、`{at, time, long}`；样式为 `short`、`medium`（默认）、`long`、`full`；值可以是 `Date`、时间戳、日期字符串或有 `toDate()` 的对象 |
| 复数 | `{count, plural, =0 {none} one {# item} other {# items}}`：先匹配 `=n` 选项，再按该语言的复数规则；`#` 是数字；支持 `offset:1` |
| 序数 | `{place, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}` |
| 选择 | `{role, select, admin {Administrator} other {User}}` |
| 转义 | `''` 输出一个撇号；`'{literal}'` 原样输出花括号（复数里的 `'#'` 输出 `#`） |

`plural`、`selectordinal` 和 `select` 必须有 `other` 选项。消息在第一次使用时解析；语法错误会抛出 `I18nMessageSyntaxException`，异常中指出了消息所在的语言、键名和出错的位置。

应用可以声明键名和它们的参数，这样写错键名或漏掉参数时，编译就会失败（`lakutata i18n types` 根据默认语言生成这份声明；没有声明时，接受任意键名）：

```text
//src/i18n.d.ts
import 'lakutata/com/i18n'

declare module 'lakutata/com/i18n' {
    interface I18nMessages {
        'order.count': { count: number }
        'order.total': { price: number | bigint, currency?: string }
    }
}
```

### 校验消息和异常

配置了中间件时，请求的校验错误（来自输入 DTO、`@Accept`/`@Return`，以及处理请求时代码里调用的 `DTO.validate`）使用请求的语言。组件在创建时（以及 `addMessages()` 添加新语言时）为它的各种语言注册内置的校验消息。内置了 20 种语言：`en`、`zh-CN`、`zh-TW`、`ja`、`ko`、`fr`、`de`、`es`、`pt-BR`、`it`、`nl`、`pl`、`ru`、`uk`、`tr`、`vi`、`th`、`id`、`hi`、`ar`。应用写在 `validation` 下的消息按错误码叠加在上面，使用校验模板的语法（不是 ICU）：

```json
{
  "validation": {
    "any": {"required": "Please enter {{#label}}"},
    "string": {"min": "{{#label}} needs {{#limit}} characters at least"}
  }
}
```

某种语言的校验消息以它回退到的语言的消息为基础，先用它自己的内置消息覆盖，再用它自己的应用消息覆盖。`validationMessages: false` 时只注册应用的消息。

请求中抛出异常时，如果 `errors.<errno>` 下有这个 `errno` 对应的消息，异常就会改用这条消息（取请求所用语言的版本），并用异常模板的参数格式化（`{id}`，逐个传入的参数用 `{0}`、`{1}`）；`errno` 保持不变：

```typescript
import {Exception} from 'lakutata'

//有消息 {"errors": {"E_ORDER_NOT_FOUND": "订单 {id} 不存在"}} 时，中文请求得到 "订单 7 不存在"
export class OrderNotFoundException extends Exception {
    public errno: string = 'E_ORDER_NOT_FOUND'
}

throw new OrderNotFoundException('Order {id} not found', {id: 7})
```

### 命令行帮助

`commanderTranslator()` 用 `cli` 下的消息（`cli.description`、`cli.commands.<command>.description`、`cli.commands.<command>.arguments.<name>`、`cli.commands.<command>.options.<property>`、`cli.help.usage`、`cli.help.options`、`cli.help.default`、`cli.prompt.json`……）按运行环境的语言翻译 Commander 适配器的帮助和提示；没有消息的文字保持英文：

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {commanderCLIEntrypoint} from 'lakutata/adapter/commander'
import {CLIAction} from 'lakutata/decorator/ctrl'
import {buildI18nOptions, commanderTranslator, I18nMiddleware} from 'lakutata/com/i18n'

class GreetController extends Controller {
    @CLIAction('greet', {description: 'Greet someone'})
    public async greet(): Promise<string> {
        return 'Hello'
    }
}

Application.run(() => ({
    id: 'tool.app',
    name: 'Tool',
    components: {
        i18n: buildI18nOptions({
            messages: {
                'zh-CN': {cli: {commands: {greet: {description: '问候某人'}}, help: {usage: '用法：', options: '选项：'}}}
            }
        }),
        entrypoint: buildEntrypoints({
            controllers: [GreetController],
            middlewares: [I18nMiddleware],
            //TOOL_LANG=zh-CN tool --help，或 LANG=zh_CN.UTF-8
            cli: commanderCLIEntrypoint({bin: 'tool', translate: commanderTranslator({environment: 'TOOL_LANG'})})
        })
    },
    bootstrap: ['entrypoint']
}))
```

### 检查翻译

`lakutata i18n check` 和 `lakutata i18n types` 背后就是 `loadCatalogs`、`checkCatalogs` 和 `generateMessageTypes` 这几个函数，脚本或 CI 中也可以直接调用：

```typescript
import {checkCatalogs, loadCatalogs, type CatalogIssue, type Catalogs} from 'lakutata/com/i18n'

const catalogs: Catalogs = await loadCatalogs(['./locales'])
const issues: CatalogIssue[] = checkCatalogs(catalogs, 'en')
for (const issue of issues) console.log(`${issue.level} ${issue.locale} ${issue.key}: ${issue.message}`)
if (issues.some((issue: CatalogIssue): boolean => issue.level === 'error')) process.exitCode = 1
```

## API

| 导出 | 说明 |
|---|---|
| `I18n` | 组件：`t`、`has`、`format`、`translator`、`negotiate`、`addMessages`、`getLocales`、`getDefaultLocale`、`getKeys`、`getTimeZone` |
| `buildI18nOptions` | 构造 `I18n` 的组件选项 |
| `I18nOptions` | 选项：`directory`、`messages`、`locales`、`defaultLocale`、`fallback`、`missing`、`currency`、`timeZone`、`validationMessages` |
| `Translator` | 作用域提供者，注入到请求中的各个对象里，使用请求的语言 |
| `ITranslator` | 某一种语言的翻译器：`locale`、`t`、`has`、`format`、`number`、`date` |
| `LocaleTranslator` | `I18n.translator()` 返回的 `ITranslator` |
| `I18nMiddleware` | 为每个请求确定语言的入口中间件（`lakutata/com/i18n`、`@lakutata/i18n/middleware`） |
| `commanderTranslator`、`CommanderTranslatorOptions` | Commander 命令行帮助的翻译及其选项（`lakutata/com/i18n`、`@lakutata/i18n/middleware`） |
| `I18nMessages`、`MessageKey`、`MessageParams` | 应用的键名和参数的声明，以及由它推导出的类型 |
| `NestedMessages`、`Catalogs` | 一种语言的消息，按键名的各段嵌套；已加载的消息，按语言和键名组织 |
| `loadCatalogs`、`checkCatalogs`、`CatalogIssue`、`generateMessageTypes` | 加载消息目录、检查翻译、生成键名的类型 |
| `normalizeLocale`、`parseAcceptLanguage`、`environmentLocales`、`negotiateLocale`、`fallbackChain` | 处理语言标签的辅助函数 |
| `parseMessage`、`messageArguments`、`MessagePart` | ICU MessageFormat 解析器，以及消息的参数 |
| `I18nCatalogException`、`I18nMessageSyntaxException`、`I18nMissingKeyException`、`I18nMissingParameterException`、`I18nTranslatorException` | 异常 |

以上全部由 `lakutata/com/i18n` 导出；`@lakutata/i18n` 导出除中间件相关以外的全部内容，中间件相关的由 `@lakutata/i18n/middleware` 导出。类型声明中的每一项都附有说明和示例。

## 错误

| 异常 | 什么时候 |
|---|---|
| `I18nCatalogException`（`E_I18N_CATALOG`） | 创建组件、`addMessages()` 或 `loadCatalogs()` 时：目录不存在、JSON 无效、文件名或目录名不是语言标签、键或值无效、选项不是语言标签、在没有应用时使用别名；`generateMessageTypes()`：默认语言没有消息 |
| `I18nMessageSyntaxException`（`E_I18N_MESSAGE_SYNTAX`） | 消息不是有效的 ICU MessageFormat，在第一次使用时（或者由 `format()`、`parseMessage()`、`generateMessageTypes()` 解析时）抛出 |
| `I18nMissingKeyException`（`E_I18N_MISSING_KEY`） | `t()`：找不到这个键的消息，且 `missing: 'throw'` |
| `I18nMissingParameterException`（`E_I18N_MISSING_PARAMETER`） | `t()`、`format()`：缺少参数，或者货币参数没有货币，且 `missing: 'throw'` |
| `I18nTranslatorException`（`E_I18N_TRANSLATOR`） | 没有配置 `I18nMiddleware` 就使用 `Translator`，或者在请求之外使用它 |
| `InvalidValueException`（来自 `lakutata`） | 创建组件时，组件的选项无效 |

## 另见

- 网站上的指南：[国际化（i18n）](https://lakutata.com/zh/guide/I18n)。
- `lakutata` 包中的 `doc/zh/I18n.md`：国际化指南。
- `@lakutata/entrypoint`（`lakutata/com/entrypoint`）：控制器、中间件和适配器。
- `@lakutata/core`（`lakutata`）：组件、`Application`、DTO 校验及其语言（`loadValidationMessages`、`registerValidationMessages`、`runInValidationLanguage`）。
- `@lakutata/cli`：`lakutata i18n check`、`lakutata i18n types` 和 `lakutata i18n add` 命令。
