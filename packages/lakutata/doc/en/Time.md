# Lakutata Time

`Time` is a `Date` in a time zone, with a moment-like API. It is exported by `lakutata` (and `@lakutata/utils`) and
has no dependency: the time zones come from the runtime (Intl), so their rules follow the Node.js version.

```typescript
import {Time} from 'lakutata'

const now = new Time()                                   // now, in the default time zone (TZ, else the system's)
const time = new Time('2024-02-29T23:30:00Z').timezone('Asia/Shanghai')
time.format('YYYY-MM-DD HH:mm Z')                        // '2024-03-01 07:30 +08:00'
time.add(1, 'month').startOf('day').format('LL')         // 'April 1, 2024'
time.diff('2024-01-01T00:00:00Z', 'days')                // 59
time.isBetween('2024-01-01', '2024-12-31', 'day', '[]')  // true
```

## Values

- A `Time` is a `Date`: it can be used wherever a `Date` is expected (`DTO.Date()`, ORM columns, `JSON.stringify`).
- The methods returning a `Time` return a new instance: `add`, `subtract`, `startOf`, `endOf`, `set`, the setters
  (`hours(5)`, `month(0)`...), `timezone(zone)`, `clone()`. The instance they are called on does not change. The methods
  inherited from `Date` (`getHours()`, `setHours()`...) read and modify the time in the time zone of the process, not
  in the one of the instance, and the setters modify the instance: use the methods of `Time`.
- The constructor takes a `Time` (its time zone too), a `Date`, a timestamp in milliseconds, a date string (a numeric
  string is a timestamp; an invalid string throws a `RangeError`), or the wall clock fields `[year, month, date, hours,
  minutes, seconds, milliseconds]` of the default time zone. Without argument (or `null`), it is now. A string without
  offset is read in the default time zone.
- An invalid time (a field of the array out of its range) does not throw: its `format()` gives `'Invalid date'`.

## Time zones

- `timezone()` gives the time zone, `timezone(zone)` a new time in another zone (the same instant); `Time.timezones()`
  lists the supported zones by their current IANA names, with `UTC` and the fixed offsets `Etc/GMT-14`…`Etc/GMT+12`.
  The former names and the aliases (`Asia/Calcutta`, `US/Eastern`) are accepted but not listed (the list of 2.x, the one
  of moment-timezone, had them). An unknown zone throws a `RangeError`.
- `utcOffset()` is the offset of the zone in minutes (480 for UTC+8); `getTimezoneOffset()` is the one of `Date`
  (-480 for UTC+8).
- The getters, the setters, the calendar operations (`add` of days, months...) and `format` use the wall clock of the
  zone. Adding days keeps the wall clock across daylight saving transitions; a wall clock time which does not exist
  moves forward.

## Arithmetic

- `add()` and `subtract()` move the wall clock for the years, quarters, months, weeks and days, and the instant for the
  hours, minutes, seconds and milliseconds: across a daylight saving change, `add(1, 'day')` keeps the hour,
  `add(24, 'hours')` does not. A month without the day takes its last day (January 31 plus one month is February 29
  in 2024).
- `diff(other, unit, precise?)` is `this - other` in the unit, truncated toward zero unless `precise` is `true`.
- `isBefore()`, `isAfter()`, `isSame()`, `isBetween()` compare at a granularity (`'day'`…); `Time.max()` and
  `Time.min()` give the latest and the earliest of several times.

## Formats

`format()` takes the format tokens of moment (English): `YYYY YY M MM MMM MMMM Do D DD DDD d dd ddd dddd E e w W Q
H HH h hh k A a m mm s ss SSS Z ZZ X x`, the long formats `LT LTS L LL LLL LLLL l ll lll llll`, and literal text in
brackets (`[today is] dddd`). The default format is `YYYY-MM-DDTHH:mm:ssZ`. `z` gives the short zone name of the
runtime (like `EST`, or `GMT+8`).
