# Lakutata 时间（Time）

`Time` 是带时区的 `Date`，提供类似 moment 的 API。它由 `lakutata`（以及 `@lakutata/utils`）导出，没有任何依赖：时区数据来自运行时（Intl），时区规则随 Node.js 版本更新。

```typescript
import {Time} from 'lakutata'

const now = new Time()                                   // 当前时间，默认时区（TZ 环境变量，否则为系统时区）
const time = new Time('2024-02-29T23:30:00Z').timezone('Asia/Shanghai')
time.format('YYYY-MM-DD HH:mm Z')                        // '2024-03-01 07:30 +08:00'
time.add(1, 'month').startOf('day').format('LL')         // 'April 1, 2024'
time.diff('2024-01-01T00:00:00Z', 'days')                // 59
time.isBetween('2024-01-01', '2024-12-31', 'day', '[]')  // true
```

## 取值

- `Time` 就是 `Date`：凡是接受 `Date` 的地方都可以使用它（`DTO.Date()`、ORM 字段、`JSON.stringify`）。
- 返回 `Time` 的方法都返回新实例：`add`、`subtract`、`startOf`、`endOf`、`set`、各设置方法（`hours(5)`、`month(0)` 等）、`timezone(zone)`、`clone()`，调用它们的实例不会改变。`Date` 自带的方法（`setHours` 等）保持 `Date` 的行为。
- 构造参数可以是 `Time`（连同其时区）、`Date`、毫秒时间戳、日期字符串（纯数字字符串视为时间戳；无效字符串抛出 `RangeError`），或默认时区的本地时间字段 `[年, 月, 日, 时, 分, 秒, 毫秒]`。不传参数（或传 `null`）表示当前时间。

## 时区

- `timezone()` 返回时区，`timezone(zone)` 返回同一时刻在另一个时区的新实例；`Time.timezones()` 列出支持的时区。未知时区抛出 `RangeError`。
- `utcOffset()` 返回时区的偏移分钟数（UTC+8 为 480）；`getTimezoneOffset()` 与 `Date` 一致（UTC+8 为 -480）。
- 取值、设置、日历运算（按天、月等加减）和 `format` 都按该时区的本地时间计算。按天加减时，跨越夏令时切换仍保持本地时间不变；不存在的本地时间会顺延。

## 格式

`format()` 使用 moment 的格式符（英文）：`YYYY YY M MM MMM MMMM Do D DD DDD d dd ddd dddd E e w W Q H HH h hh k A a m mm s ss SSS Z ZZ X x`，本地化格式 `LT LTS L LL LLL LLLL l ll lll llll`，方括号中的文字原样输出（`[today is] dddd`）。默认格式为 `YYYY-MM-DDTHH:mm:ssZ`。`z` 输出运行时提供的时区简称（如 `EST` 或 `GMT+8`）。
