# @lakutata/i18n

The internationalization component of the lakutata framework: the application's messages in each language, by key,
written in [ICU MessageFormat](https://unicode-org.github.io/icu/userguide/format_parse/messages/) and formatted in their
language by the `Intl` of Node.js (numbers, currencies, dates, plurals, selects), with no third-party library. It also
provides the middleware choosing the language of each request (its `Translator`, its validation errors and its
exceptions in that language), the translation of the Commander CLI help, and the tools checking the translations. The
umbrella package `lakutata` re-exports it as `lakutata/com/i18n`.

## Installation

```shell
npm install lakutata
```

The component needs nothing more. `I18nMiddleware` and `commanderTranslator` use the entrypoint component
(`lakutata/com/entrypoint`, the optional peer dependency `@lakutata/entrypoint`), included in `lakutata`.

## Usage

### The component and its messages

Register the component with `buildI18nOptions()` in the `components` of the application, named `i18n` (the name the
middleware and `commanderTranslator` use), and give it its messages:

- `directory`: one or several directories (a path, or an alias of the application such as `@locales`) read when the
  component is created. A language is a JSON file named by its tag (`en.json`, `zh-CN.json`), or a directory named by
  its tag whose files and subdirectories prefix their keys (`zh-TW/order.json` gives `order.*`,
  `zh-TW/admin/user.json` gives `admin.user.*`). Both layouts can be mixed.
- `messages`: the messages by language in the code (object literals or imported JSON), bundled with it; added after
  the directories, they replace the same keys.

The nesting of the JSON is the one of the keys: `{"order": {"count": "..."}}` holds the key `order.count`; a key part
cannot contain `.`.

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
                //The default language: the last fallback, and the language chosen when none is supported
                defaultLocale: 'en',
                //A message missing in zh-TW is looked up in zh-CN, then zh, then en
                fallback: {'zh-TW': 'zh-CN'},
                //The currency of {price, number, currency} when the message and its arguments give none
                currency: 'CNY',
                //The time zone of the dates and the times (the process's one by default)
                timeZone: 'Asia/Shanghai'
            })
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const i18n: I18n = await app.getObject('i18n')
        console.log(i18n.t('order.count', {count: 1200})) //1,200 orders
        console.log(i18n.t('order.count', {count: 0}, 'zh-CN')) //暂无订单
        //Missing in zh-CN: the English message, formatted in Chinese
        console.log(i18n.t('order.total', {price: 9.5}, 'zh-CN')) //Total: ¥9.50
    })
```

| Option | Default | Description |
|---|---|---|
| `directory` | none | The directories of the messages, aliases accepted; the later ones replace the same keys |
| `messages` | none | The messages by language given in the code, added after the directories |
| `locales` | the default language, then the languages of the messages (alphabetical) | The supported languages, which `negotiate()` chooses from |
| `defaultLocale` | `'en'` | The default language |
| `fallback` | none | The languages a message missing in a language is looked up in next (`{'zh-TW': 'zh-CN'}`, or a list) |
| `missing` | `'throw'`, `'key'` when `NODE_ENV=production` | `'throw'` throws on a missing message, argument or currency; `'key'` gives the key, writes a missing argument as `{name}` and a currency argument without a currency as a plain number, each with a warning `I18nWarning` emitted once (per key, or per message and argument) |
| `currency` | none | The ISO 4217 currency of `{price, number, currency}` when neither the style nor a `currency` argument gives one (without it, such a message throws, or gives a plain number with `missing: 'key'`) |
| `timeZone` | the process's | The IANA time zone of the dates and the times |
| `validationMessages` | `true` | Whether the built-in validation messages of the languages are registered |

**Fallbacks.** A message missing in a language is looked up in its `fallback` languages (and theirs), then in its less
specific tags (`zh-Hant-TW`, `zh-Hant`, `zh`), then in the default language. It is always formatted in the language
asked: an English message given to a German request writes `1.000`. A key found nowhere throws
`I18nMissingKeyException`, or gives the key itself with `missing: 'key'`.

**Out of a request** (a schedule, a singleton component), the component gives `t(key, params, locale)`,
`has(key, locale)`, `format(message, params, locale)`, and `translator(locale)`, a translator of one language. None of
them negotiates the language: an unsupported language is looked up as given, then falls back.

**At run time**, `addMessages(locale, messages)` adds or replaces messages. A new language becomes supported
(`getLocales()`, `negotiate()`) unless the `locales` option lists the languages, and its validation messages are
registered as at the creation; the promise it returns resolves once they are (the messages themselves are given by
`t()` as soon as it returns).

### The translator of a request

With `I18nMiddleware` in the `middlewares` of the entrypoint, each request has a language, and its objects (the
controller, the `@Scoped` providers, the access control rules) inject the same `Translator` of that language:

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

A translator (`Translator`, and the `ITranslator` of `translator(locale)`) has `locale`, `t(key, params)`, `has(key)`,
`format(message, params)`, `number(value, options)` (`Intl.NumberFormat`) and `date(value, options)`
(`Intl.DateTimeFormat`, in the `timeZone` option). The `Translator` of a request without the middleware throws
`I18nTranslatorException`.

### The language of each request

The middleware reads the languages a request asks for, preferred first, then negotiates them with the supported
languages (the default language when none matches) and sets `context.locale`:

| Transport | Languages read, preferred first |
|---|---|
| HTTP (Express, Fastify) | The query parameter `?lang=`, the cookie `lang`, then `Accept-Language` (by quality) |
| Socket.IO | The query parameter `lang`, the cookie `lang` and `Accept-Language` of the connection's handshake |
| HTTP service adapter, JSON-RPC adapter (HTTP, WebSocket) | The query parameter `lang`, the cookie `lang` and `Accept-Language` of the HTTP request (for WebSocket, of the request opening the connection) |
| Command line, Electron IPC, JSON-RPC over stdio | The variable named by `environmentVariable` (none by default), `LANGUAGE`, `LC_ALL`, `LC_MESSAGES`, `LANG`, then the process's language |
| Schedules | None: the default language |

A query or cookie value which is not a language tag is skipped. The negotiation tries each requested language in turn:
the same tag, then its language alone (`en-GB` gives `en`), then another tag of its language (`pt-PT` gives `pt-BR`, in
the order of the supported languages).

A subclass changes the component (`@Inject('...') protected readonly i18n`), the names `queryParameter` and `cookie`,
`environmentVariable`, or the languages read (`requested(context)`):

```typescript
import {type BaseContext} from 'lakutata/com/entrypoint'
import {I18nMiddleware} from 'lakutata/com/i18n'

export class LanguageMiddleware extends I18nMiddleware {
    protected readonly queryParameter: string = 'locale'

    protected readonly environmentVariable: string = 'SHOP_LANG'

    //The language saved by the signed-in user first
    protected requested(context: BaseContext): string[] {
        const saved: unknown = context.data.userLanguage
        return [...(typeof saved === 'string' ? [saved] : []), ...super.requested(context)]
    }
}
```

### The messages: interpolation, plurals, formatting

| Syntax | Example |
|---|---|
| Argument | `Hello, {name}`: a number is formatted in the language, a `Date` as a date, the rest as a string |
| Number | `{n, number}`, `{n, number, integer}`, `{n, number, percent}` |
| Currency | `{price, number, currency}` (the `currency` argument, else the `currency` option), `{price, number, currency/EUR}` |
| Date, time | `{at, date, short}`, `{at, time, long}`; the styles `short`, `medium` (the default), `long`, `full`; a `Date`, a timestamp, a date string or an object with `toDate()` |
| Plural | `{count, plural, =0 {none} one {# item} other {# items}}`: the `=n` options first, then the plural rules of the language; `#` is the number; `offset:1` supported |
| Ordinal | `{place, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}` |
| Select | `{role, select, admin {Administrator} other {User}}` |
| Quoting | `''` writes an apostrophe; `'{literal}'` writes braces (`'#'` writes `#` in a plural) |

`plural`, `selectordinal` and `select` need an `other` option. A message is parsed the first time it is used; a syntax
error throws `I18nMessageSyntaxException` naming its language, key and position.

The application can declare its keys and their arguments, so that a wrong key or a missing argument fails the
compilation (`lakutata i18n types` generates it from the default language; without it, any key is accepted):

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

### The validation messages and the exceptions

With the middleware, the validation errors of a request (its input DTO, `@Accept`/`@Return`, the `DTO.validate` calls
of its code) are in its language. The component registers, when it is created (and for a language added by
`addMessages()`), the built-in validation messages of its languages (20 languages are built in: `en`, `zh-CN`,
`zh-TW`, `ja`, `ko`, `fr`, `de`, `es`, `pt-BR`, `it`, `nl`, `pl`, `ru`, `uk`, `tr`, `vi`, `th`, `id`, `hi`, `ar`), layered with the application's messages under `validation`, by error
code, in the syntax of the validation templates (not ICU):

```json
{
  "validation": {
    "any": {"required": "Please enter {{#label}}"},
    "string": {"min": "{{#label}} needs {{#limit}} characters at least"}
  }
}
```

A language's validation messages are those of the languages it falls back to, replaced by its own built-in ones, then
by its own application messages. `validationMessages: false` registers the application's messages only.

An exception thrown by a request whose `errno` has a message `errors.<errno>` gets that message in the request's
language, formatted with the parameters of its template (`{id}`, or `{0}`, `{1}` for the parameters given one by one);
its `errno` is unchanged:

```typescript
import {Exception} from 'lakutata'

//With the message {"errors": {"E_ORDER_NOT_FOUND": "订单 {id} 不存在"}}, a Chinese request gets "订单 7 不存在"
export class OrderNotFoundException extends Exception {
    public errno: string = 'E_ORDER_NOT_FOUND'
}

throw new OrderNotFoundException('Order {id} not found', {id: 7})
```

### The command line help

`commanderTranslator()` translates the help and the prompts of the Commander adapter with the messages under `cli`
(`cli.description`, `cli.commands.<command>.description`, `cli.commands.<command>.arguments.<name>`,
`cli.commands.<command>.options.<property>`, `cli.help.usage`, `cli.help.options`, `cli.help.default`,
`cli.prompt.json`…), in the language of the environment; a text without a message stays in English:

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
            //TOOL_LANG=zh-CN tool --help, or LANG=zh_CN.UTF-8
            cli: commanderCLIEntrypoint({bin: 'tool', translate: commanderTranslator({environment: 'TOOL_LANG'})})
        })
    },
    bootstrap: ['entrypoint']
}))
```

### Checking the translations

`loadCatalogs`, `checkCatalogs` and `generateMessageTypes` are the functions behind `lakutata i18n check` and
`lakutata i18n types`, for a script or the CI:

```typescript
import {checkCatalogs, loadCatalogs, type CatalogIssue, type Catalogs} from 'lakutata/com/i18n'

const catalogs: Catalogs = await loadCatalogs(['./locales'])
const issues: CatalogIssue[] = checkCatalogs(catalogs, 'en')
for (const issue of issues) console.log(`${issue.level} ${issue.locale} ${issue.key}: ${issue.message}`)
if (issues.some((issue: CatalogIssue): boolean => issue.level === 'error')) process.exitCode = 1
```

## API

| Export | What it is |
|---|---|
| `I18n` | The component: `t`, `has`, `format`, `translator`, `negotiate`, `addMessages`, `getLocales`, `getDefaultLocale`, `getKeys`, `getTimeZone` |
| `buildI18nOptions` | Builds the component options of `I18n` |
| `I18nOptions` | The options: `directory`, `messages`, `locales`, `defaultLocale`, `fallback`, `missing`, `currency`, `timeZone`, `validationMessages` |
| `Translator` | The scoped provider injected in the objects of a request, in the request's language |
| `ITranslator` | A translator of one language: `locale`, `t`, `has`, `format`, `number`, `date` |
| `LocaleTranslator` | The `ITranslator` given by `I18n.translator()` |
| `I18nMiddleware` | The entrypoint middleware choosing the language of each request (`lakutata/com/i18n`, `@lakutata/i18n/middleware`) |
| `commanderTranslator`, `CommanderTranslatorOptions` | The translation of the Commander CLI help, and its options (`lakutata/com/i18n`, `@lakutata/i18n/middleware`) |
| `I18nMessages`, `MessageKey`, `MessageParams` | The declaration of the application's keys and arguments, and the types derived from it |
| `NestedMessages`, `Catalogs` | The messages of a language nested by key parts; the loaded messages by language and key |
| `loadCatalogs`, `checkCatalogs`, `CatalogIssue`, `generateMessageTypes` | Load the message directories, check the translations, generate the key types |
| `normalizeLocale`, `parseAcceptLanguage`, `environmentLocales`, `negotiateLocale`, `fallbackChain` | The language tag helpers |
| `parseMessage`, `messageArguments`, `MessagePart` | The ICU MessageFormat parser and the arguments of a message |
| `I18nCatalogException`, `I18nMessageSyntaxException`, `I18nMissingKeyException`, `I18nMissingParameterException`, `I18nTranslatorException` | The exceptions |

All are exported by `lakutata/com/i18n`; `@lakutata/i18n` exports them except the middleware ones, exported by
`@lakutata/i18n/middleware`. The typings document each declaration with examples.

## Errors

| Exception | When |
|---|---|
| `I18nCatalogException` (`E_I18N_CATALOG`) | The component's creation, `addMessages()` or `loadCatalogs()`: a missing directory, invalid JSON, a file or directory name which is not a language tag, an invalid key or value, an option which is not a language tag, an alias without an application; `generateMessageTypes()`: the default language has no messages |
| `I18nMessageSyntaxException` (`E_I18N_MESSAGE_SYNTAX`) | A message is not valid ICU MessageFormat, when it is first used (or parsed by `format()`, `parseMessage()`, `generateMessageTypes()`) |
| `I18nMissingKeyException` (`E_I18N_MISSING_KEY`) | `t()`: no message has the key, with `missing: 'throw'` |
| `I18nMissingParameterException` (`E_I18N_MISSING_PARAMETER`) | `t()`, `format()`: an argument is missing, or a currency argument has no currency, with `missing: 'throw'` |
| `I18nTranslatorException` (`E_I18N_TRANSLATOR`) | The `Translator` is used without the `I18nMiddleware`, or out of a request |
| `InvalidValueException` (from `lakutata`) | The component's options are invalid, when it is created |

## See also

- `doc/en/I18n.md` of the package `lakutata` (Chinese in `doc/zh`): the guide of the internationalization.
- `@lakutata/entrypoint` (`lakutata/com/entrypoint`): the controllers, the middlewares and the adapters.
- `@lakutata/core` (`lakutata`): the components, `Application`, the DTO validation and its languages
  (`loadValidationMessages`, `registerValidationMessages`, `runInValidationLanguage`).
- `@lakutata/cli`: the `lakutata i18n check`, `lakutata i18n types` and `lakutata i18n add` commands.
