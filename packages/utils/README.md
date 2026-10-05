# @lakutata/utils

The utilities of the lakutata framework: `Time`, a date and time in an IANA time zone with the API of moment (formatting,
calendar arithmetic across the daylight saving time changes, comparisons), and the helpers the framework and its
applications share: strings, objects, arrays and sets, hashes and encodings, UUIDs, IP addresses, globs, statistics. The
helpers are plain functions and classes, usable anywhere, inside an application or not. The umbrella package `lakutata`
re-exports them as `lakutata/utils`, and `Time` from `lakutata` too.

## Installation

```shell
npm install lakutata
```

It has no optional dependencies: everything is implemented on Node.js (22 or later) and its `Intl` time zone data.

## Usage

### The helpers in an application

Import the helpers where they are needed: they need no registration.

```typescript
import {Application, Component, Time} from 'lakutata'
import {objectHash, randomString, templating, UUID} from 'lakutata/utils'

class Invitations extends Component {
    public invite(email: string): {id: string, code: string, key: string, message: string, expires: string} {
        const expires: Time = new Time().timezone('Europe/Paris').add(7, 'days').endOf('day')
        return {
            id: UUID.v4(),
            code: randomString(6, 'numeric'),
            //The same invitation always gives the same key
            key: objectHash({email: email}),
            message: templating('Your invitation to {app} expires on {date}', {app: 'Lakutata', date: expires.format('LL')}),
            expires: expires.format()
        }
    }
}

Application
    .run(() => ({
        id: 'utils.app',
        name: 'Utils',
        components: {
            invitations: {class: Invitations}
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const invitations: Invitations = await app.getObject('invitations')
        console.log(invitations.invite('ada@example.com'))
    })
```

### Strings, objects and collections

```typescript
import {camelCase, mergeMap, noCase, ObjectPath, sortArray, sortObject, templating, uniqueArray} from 'lakutata/utils'

console.log(camelCase('user_id'), '|', noCase('XMLHttpRequest'))
//userId | xml http request

const config: Record<string, any> = {db: {hosts: [{name: 'primary', port: 5432}]}}
console.log(ObjectPath.get<number>(config, 'db.hosts[0].port'))
//5432
//{{name}} escapes the HTML, {name} does not
console.log(templating('<p>Hello {{name}}</p>', {name: '<b>Ada</b>'}))
//<p>Hello &lt;b&gt;Ada&lt;/b&gt;</p>

type Person = {name: string, age: number}
const people: Person[] = [{name: 'Bob', age: 30}, {name: 'Ada', age: 30}, {name: 'Cy', age: 20}]
//In place: the oldest first, by name among the same age
sortArray(people, {by: ['age', 'name'], order: ['desc', 'asc']})
console.log(people.map((person: Person): string => person.name))
//['Ada', 'Bob', 'Cy']
console.log(uniqueArray([3, 1, 3, 2]), Object.keys(sortObject({b: 1, a: 2})))
//[3, 1, 2] ['a', 'b']
console.log([...mergeMap(new Map([['a', 1]]), new Map([['a', 2], ['b', 3]]))])
//[['a', 2], ['b', 3]]
```

### Hashes, encodings and identifiers

```typescript
import {md5, MessagePack, objectHash, sha256, signedToHex, hexToSigned, UUID} from 'lakutata/utils'

console.log(sha256('hello').toString('hex').slice(0, 16), md5('hello').length)
//2cf24dba5fb0a30e 16
//Deeply equal values give the same hash, whatever the order of their keys
console.log(objectHash({a: 1, b: 2}) === objectHash({b: 2, a: 1}))
//true
const packed: string = MessagePack.stringify({id: 1, at: new Date(0)})
console.log(MessagePack.parse(packed))
//{id: 1, at: 1970-01-01T00:00:00.000Z}
console.log(signedToHex(-2, 16), hexToSigned('FFFE'))
//FFFE -2
const DNS: string = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
console.log(UUID.validate(UUID.v4()), UUID.v5('example.com', DNS))
//true cfbff0d1-9375-5685-968c-48ce8b15ae17
```

### Files, async and statistics

```typescript
import {delay, Glob, pathExists, Statistics} from 'lakutata/utils'

if (await pathExists('./src')) {
    const sources: string[] = await Glob('src/**/*.ts')
    console.log(`${sources.length} TypeScript files`)
}
await delay(100)
const latencies: number[] = [12, 15, 11, 90, 14, 13]
console.log(Statistics.median(latencies), Statistics.quantile(latencies, 0.9))
//13.5 90
```

### Time

A `Time` is an instant in a time zone: `new Time()` is now in the default zone (the `TZ` environment variable, else the
system's), `timezone(name)` gives the same instant in another zone. Its methods never modify it: the setters and the
arithmetic return a new `Time`.

#### Time zones

```typescript
import {Time} from 'lakutata'

//An ISO 8601 string with an offset (or Z) is exact; without one, it is read in the default time zone
const meeting: Time = new Time('2024-03-09T15:00:00Z')
console.log(meeting.timezone('Asia/Shanghai').format(), meeting.timezone('America/New_York').format())
//2024-03-09T23:00:00+08:00 2024-03-09T10:00:00-05:00
const paris: Time = meeting.timezone('Europe/Paris')
console.log(paris.timezone(), paris.utcOffset(), paris.hours())
//Europe/Paris 60 16
//Set the wall clock fields in the zone
console.log(paris.hours(9).minutes(30).format())
//2024-03-09T09:30:00+01:00
console.log(Time.timezones().includes('Asia/Kolkata'))
//true
```

A string without offset and the array of the wall clock fields are read in the time zone of the `Time` reading them:
the default zone for `new Time()`, the instance's zone for its comparisons and `diff()` (`paris.isSame('2024-03-09',
'day')` is a day in Paris). `timezone()` throws a `RangeError` for a zone the runtime does not know, and `timezone('')`
gives the default zone. The methods inherited from `Date`
(`getHours()`, `setHours()`…) use the process's time zone and modify the instance: use the `Time` methods instead.

#### Formatting

`format()` takes the tokens of moment (in English); the text in brackets is kept as is.

```typescript
import {Time} from 'lakutata'

const time: Time = new Time('2024-03-09T15:04:05.123Z').timezone('America/New_York')
console.log(time.format())
//2024-03-09T10:04:05-05:00
console.log(time.format('YYYY-MM-DD HH:mm:ss.SSS Z'))
//2024-03-09 10:04:05.123 -05:00
console.log(time.format('dddd, MMMM Do YYYY [at] h:mm A z'))
//Saturday, March 9th 2024 at 10:04 AM EST
console.log(time.format('LLLL'), '|', time.format('X'))
//Saturday, March 9, 2024 10:04 AM | 1709996645
console.log(time.toObject())
//{years: 2024, months: 2, date: 9, hours: 10, minutes: 4, seconds: 5, milliseconds: 123}
```

#### Arithmetic and comparisons

```typescript
import {Time} from 'lakutata'

const start: Time = new Time('2024-03-09T12:00:00Z').timezone('America/New_York')
//The days keep the wall clock across the daylight saving time change, the hours move the instant
console.log(start.add(1, 'day').format(), start.add(24, 'hours').format())
//2024-03-10T07:00:00-04:00 2024-03-10T08:00:00-04:00
//A month without the day takes its last day
console.log(new Time('2024-01-31T12:00:00Z').timezone('UTC').add(1, 'month').format('YYYY-MM-DD'))
//2024-02-29
console.log(start.startOf('week').format(), start.endOf('month').format('YYYY-MM-DD HH:mm:ss.SSS'))
//2024-03-03T00:00:00-05:00 2024-03-31 23:59:59.999
console.log(start.add(1, 'day').diff(start, 'days'), start.add(1, 'day').diff(start, 'hours'))
//1 23
console.log(start.isSame('2024-03-09T23:00:00-05:00', 'day'), start.isBefore('2024-03-10T00:00:00-05:00'))
//true true
console.log(start.isBetween('2024-03-01', '2024-03-31', null, '[]'), Time.max(start, start.add(1, 'h')).format())
//true 2024-03-09T08:00:00-05:00
```

- `add()` and `subtract()` move the wall clock for the years, quarters, months, weeks and days (their fractions
  rounded: `1.5` days is 2 days), and the instant for the hours, minutes, seconds and milliseconds.
- A wall clock time skipped by a daylight saving time change (02:30 when the clocks jump from 02:00 to 03:00) moves
  forward by the length of the gap (03:30), whatever the time it comes from; a repeated one (the clocks turned back)
  keeps the offset of the time when it can, else is the earlier one.
- `diff()` is `this - other`, truncated toward zero unless its third argument is `true`; the months count calendar
  months, the days the wall clock days.
- An invalid time (an array field out of range) does not throw: `format()` gives `'Invalid date'`, and `Time.max()` and
  `Time.min()` ignore it.

## API

All are exported by `lakutata/utils` and `@lakutata/utils`; `Time` also by `lakutata`. The typings document each
declaration with examples.

### Time

| Export | What it is |
|---|---|
| `Time` | A date and time in a time zone: `timezone`, the field getters and setters (`year`, `month`, `date`, `hours`, `weekday`, `isoWeeks`…), `get`/`set`, `add`/`subtract`, `startOf`/`endOf`, `format`, `diff`, `isBefore`/`isSame`/`isAfter`/`isBetween`, `toObject`, `clone`; the static `timezones`, `max`, `min` |
| `TimeInput` | What `new Time()` and the comparisons accept: a `Time`, a `Date`, milliseconds, a date string, the wall clock fields |
| `TimeObject` | The wall clock fields given by `toObject()` |
| `UnitOfTime` | The units of the `Time` methods (`'day'`, `'days'`, `'d'`…) |

### Strings

| Export | What it is |
|---|---|
| `camelCase` | Convert a string of any case into camelCase |
| `noCase`, `NoCaseOptions`, `SplitOptions` | Convert a string of any case into lower case words separated by spaces |
| `templating`, `TemplatingOptions`, `MissingValueError` | Fill the `{key}` and `{{key}}` (HTML-escaped) placeholders of a template |
| `randomString` | A random string of a length, from a named or custom character set |
| `nonceString` | A random string of 32 letters and digits |

### Objects and classes

| Export | What it is |
|---|---|
| `As` | Cast a value to a type, for the type checker only |
| `cloneDeep` | Deep copy a value, its classes, collections and circular references kept |
| `ObjectPath` | Get, set and test a nested property by its path (`'a.b[0].c'`); the paths through a prototype are refused |
| `getObjectPropertyPaths` | List the paths of the leaf values of an object |
| `getObjectNestingDepth` | Measure how deeply an object nests |
| `isEmptyObject` | Whether a value is empty: `null`, `undefined`, an empty `Map` or `Set`, an object without own property |
| `objectHash`, `ObjectHashOptions` | Hash a value by its content, whatever the order of its keys |
| `sortKeys`, `SortKeysOptions` | Copy a plain object with its keys sorted by a comparison |
| `sortObject`, `SortObjectOptions` | Copy a plain object with its keys in alphabetical order |
| `objectToMap` | Convert an object into a map of its properties |
| `objectConstructor` | The class of an object |
| `objectPrototype` | The prototype of a class |
| `objectParentConstructor`, `objectParentConstructors` | The parent class, and all the ancestors, of a class |
| `isSubclassOf` | Whether a class extends another one |

### Arrays and sets

| Export | What it is |
|---|---|
| `sortArray`, `SortArrayOptions` | Sort an array in place by its items or their properties |
| `uniqueArray` | Remove the duplicates of an array |
| `mergeArray`, `mergeSet`, `mergeMap` | Merge two arrays, sets or maps into a new one |
| `arrayToSet`, `setToArray` | Convert between an array and a set |
| `convertArrayLikeToIterable`, `convertArrayLikeToStream` | Iterate or stream the items of a string, a buffer or a typed array |
| `Statistics`, `LinearRegression` | Means, quantiles, deviations, regressions, distributions and random samples of numbers |

### Async, process and files

| Export | What it is |
|---|---|
| `delay` | Wait for a number of milliseconds |
| `gracefulExit` | Exit the process once cleanup functions have run |
| `DevNull` | Accept any arguments and ignore them |
| `isPromise`, `isPromiseLike` | Whether a value is a real promise, or any thenable |
| `isAbortError` | Whether an error is an abort error: named `AbortError` (`AbortController.abort()`, `fetch`) or of code `ABORT_ERR` (Node.js) |
| `pathExists` | Whether a file or a directory exists |
| `isPath` | Whether a string is written as a file system path |
| `Glob`, `GlobSync`, `GlobOptions` | List the files matching glob patterns |
| `isGlobString` | Whether a string is a glob pattern |

### Encodings, hashes and identifiers

| Export | What it is |
|---|---|
| `md5`, `sha1`, `sha256` | The digest of a string, as a `Buffer` |
| `MessagePack` | Serialize values to and from MessagePack bytes or strings (a `Map` decodes as an object, a `Set` as an array) |
| `UUID`, `UUIDTypes`, `UUIDVersion1Options`, `UUIDVersion4Options`, `UUIDVersion6Options` | Generate (v1, v3, v4, v5, v6), validate, parse and stringify UUIDs |
| `URLBuilder`, `URLAttributes` | Parse a URL of any scheme into its attributes, or build one from them |
| `hexToUnsigned`, `unsignedToHex` | Convert between hexadecimal and unsigned integers |
| `hexToSigned`, `signedToHex` | Convert between hexadecimal and signed integers (two's complement) |
| `hexToIEEE754`, `ieee754ToHex` | Convert between hexadecimal and IEEE 754 floating-point numbers |
| `IP`, `IPv4`, `IPv6`, `IPBinHex`, `IPv4Subnet`, `IPv6Subnet`, `IPv6Result` | Validate, convert and compare IP addresses and CIDR blocks |

### Type guards

| Export | What it is |
|---|---|
| `isSymbol` | Whether a value is a symbol |
| `isNativeFunction` | Whether a function is implemented natively |
| `isHTML` | Whether a string looks like HTML |
| `isXML` | Whether a string is a well-formed XML document |

## Errors

The utilities throw the standard JavaScript errors, and one error class of their own; the guards (`Is*`) return
`false` instead of throwing.

| Error | Thrown when |
|---|---|
| `RangeError` | `new Time()` (and the `Time` comparisons) with a string which is not a date; `Time.timezone()` with an unknown time zone; `randomString()` with a negative or fractional length or an empty character set; `signedToHex()`/`unsignedToHex()` with a number which is not an integer or does not fit in the width; `hexToSigned()`/`hexToUnsigned()` with a value beyond `Number.MAX_SAFE_INTEGER`; `hexToIEEE754()` with other than 8 or 16 digits; `UUID.v1()`/`UUID.v3()`/`UUID.v4()`/`UUID.v5()`/`UUID.v6()` with a buffer too small (nothing written); `MessagePack.encode()` with a `bigint` out of the 64-bit ranges; `MessagePack.decode()` with empty or truncated bytes |
| `SyntaxError` | `hexToSigned()`, `hexToUnsigned()`, `hexToIEEE754()` with a character which is not a hexadecimal digit, or no digit |
| `TypeError` | `UUID.parse()`, `UUID.version()`, `UUID.v3()`/`UUID.v5()` with an invalid UUID; `sortKeys()`/`sortObject()` with a value which is not a plain object or an array; `sortArray()` by a property of an item which is `null` or `undefined`; `ObjectPath.set()` through a `null` value, or with a path through `__proto__`, `constructor` or `prototype`; `templating()` with a template which is not a string |
| `MissingValueError` | `templating()` with a placeholder without value, unless `ignoreMissing` |
| `Error` | `objectHash()` with `undefined`, an unknown algorithm or encoding, or an unsupported type (a `Promise`) without `ignoreUnknown`; `MessagePack.encode()` with a function, a symbol, a `Map` key which is neither a string nor a number, or more than 100 levels of nesting; the `Statistics` methods with an empty or too short array |

The typings of each helper list the errors it throws.

## See also

- `doc/en/HelperFunctions.md` and `doc/en/Time.md` of the package `lakutata` (Chinese in `doc/zh`): the guides of the
  helpers and of `Time`.
- `@lakutata/core` (`lakutata`): `Application`, the components and the dependency injection, which re-exports `Time`.
- `@lakutata/security` (`lakutata/security`): the passwords, signatures and encryption, for the hashes used as secrets.
