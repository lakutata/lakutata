# Lakutata Helper Functions

`lakutata/utils` (package `@lakutata/utils`) exports the helpers the framework and its applications share: strings,
objects, arrays and sets, hashes and encodings, UUIDs, IP addresses, globs, statistics, and `Time`
(see [Time](Time.md)). They are plain functions and classes with no dependencies: import them wherever they are needed,
inside an application or not; nothing needs to be registered. The README of `@lakutata/utils` and the type declarations
of each helper give the details, including the errors they throw.

```typescript
import {Application, Component, Time} from 'lakutata'
import {objectHash, randomString, templating, UUID} from 'lakutata/utils'

class Invitations extends Component {
    public invite(email: string): { id: string, code: string, key: string, message: string } {
        const expires: Time = new Time().timezone('Europe/Paris').add(7, 'days').endOf('day')
        return {
            id: UUID.v4(),
            code: randomString(6, 'numeric'),
            //The same invitation always gives the same key
            key: objectHash({email: email}),
            message: templating('Your invitation to {app} expires on {date}', {app: 'Lakutata', date: expires.format('LL')})
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
        const invitations: Invitations = await app.getObject<Invitations>('invitations')
        console.log(invitations.invite('ada@example.com'))
    })
```

## 1. Strings

| Helper | What it does |
|---|---|
| `camelCase(text)` | Converts a string of any case into camelCase |
| `noCase(text, options?)` | Converts a string of any case into lower case words separated by spaces |
| `templating(template, data, options?)` | Fills the `{key}` placeholders, and the `{{key}}` ones HTML-escaped; `MissingValueError` for a missing value unless `ignoreMissing` |
| `randomString(length?, charset?)` | A random string, from a named character set (`'alphanumeric'`, `'alphabetic'`, `'numeric'`, `'hex'`, `'binary'`, `'octal'`) or a custom one |
| `nonceString()` | A random string of 32 letters and digits |

## 2. Objects, arrays and sets

| Helper | What it does |
|---|---|
| `ObjectPath.get()`, `.set()`, `.has()` | Reads, sets and tests a nested property by its path (`'a.b[0].c'`) |
| `cloneDeep(value)` | A deep copy that keeps classes, collections and circular references |
| `objectHash(value, options?)` | A hash of a value by its content, whatever the order of its keys |
| `sortArray(array, ...options)` | Sorts an array in place, by its items or their properties (`by`, `order`, `customOrders`, `computed`) |
| `sortKeys(object, options?)` | A copy of a plain object with its keys sorted by a comparison (`deep`, `compare`) |
| `sortObject(object, options?)` | A copy of a plain object with its keys in alphabetical order (`deep`, `order: 'asc' \| 'desc'`) |
| `uniqueArray(array)` | The array without its duplicates |
| `mergeArray`, `mergeSet`, `mergeMap` | Merge two arrays, sets or maps into a new one |
| `arrayToSet`, `setToArray`, `objectToMap` | Conversions between collections |
| `getObjectPropertyPaths`, `getObjectNestingDepth`, `isEmptyObject` | The paths of the leaf values of an object, its depth, whether it has no own property |
| `objectConstructor`, `objectPrototype`, `objectParentConstructor(s)`, `isSubclassOf` | Classes and their ancestors |
| `Statistics` | Means, quantiles, deviations, regressions, distributions and random samples of numbers |

```typescript
import {camelCase, noCase, ObjectPath, sortArray, sortObject, templating, uniqueArray} from 'lakutata/utils'

console.log(camelCase('user_id'), '|', noCase('XMLHttpRequest'))
//userId | xml http request

const config: Record<string, any> = {db: {hosts: [{name: 'primary', port: 5432}]}}
console.log(ObjectPath.get<number>(config, 'db.hosts[0].port'))
//5432

//{{name}} escapes the HTML, {name} does not
console.log(templating('<p>Hello {{name}}</p>', {name: '<b>Ada</b>'}))
//<p>Hello &lt;b&gt;Ada&lt;/b&gt;</p>

type Person = { name: string, age: number }
const people: Person[] = [{name: 'Bob', age: 30}, {name: 'Ada', age: 30}, {name: 'Cy', age: 20}]
//In place: the oldest first, by name among the same age
sortArray(people, {by: ['age', 'name'], order: ['desc', 'asc']})
console.log(people.map((person: Person): string => person.name))
//['Ada', 'Bob', 'Cy']

console.log(uniqueArray([3, 1, 3, 2]), Object.keys(sortObject({b: 1, a: 2})))
//[3, 1, 2] ['a', 'b']
```

## 3. Hashes, encodings and identifiers

| Helper | What it does |
|---|---|
| `md5(text)`, `sha1(text)`, `sha256(text)` | The digest of a string, as a `Buffer` (for checksums; for passwords and secrets, see [Security](Security.md)) |
| `MessagePack` | Serializes values to and from MessagePack bytes or strings |
| `UUID` | Generates (`v1`, `v3`, `v4`, `v5`, `v6`), validates, parses and stringifies UUIDs |
| `URLBuilder` | Parses a URL of any scheme into its attributes, or builds one from them |
| `hexToUnsigned`, `unsignedToHex(value, bits = 32)` | Converts between hexadecimal and unsigned integers (8 to 128 bits) |
| `hexToSigned`, `signedToHex(value, bits = 32)` | Converts between hexadecimal and signed integers (two's complement) |
| `hexToIEEE754`, `ieee754ToHex` | Converts between hexadecimal and IEEE 754 floating point numbers |
| `IP`, `IPv4`, `IPv6` | Validate, convert and compare IP addresses and CIDR blocks |

```typescript
import {hexToSigned, md5, objectHash, sha256, signedToHex, UUID} from 'lakutata/utils'

console.log(sha256('hello').toString('hex').slice(0, 16), md5('hello').length)
//2cf24dba5fb0a30e 16
//Deeply equal values give the same hash, whatever the order of their keys
console.log(objectHash({a: 1, b: 2}) === objectHash({b: 2, a: 1}))
//true
console.log(signedToHex(-2, 16), hexToSigned('FFFE'))
//FFFE -2
console.log(UUID.validate(UUID.v4()))
//true
```

## 4. Async, process and files

| Helper | What it does |
|---|---|
| `delay(ms)` | Waits for a number of milliseconds |
| `gracefulExit` | Exits the process once cleanup functions have run |
| `pathExists(path)`, `isPath(text)` | Whether a file or directory exists; whether a string looks like a path |
| `Glob(patterns, options?)`, `GlobSync`, `isGlobString` | The files matching glob patterns; whether a string is a glob pattern |
| `isPromise`, `isPromiseLike`, `isAbortError` | Whether a value is a promise or a thenable; whether an error is an abort error of Node.js |
| `isSymbol`, `isNativeFunction`, `isHTML`, `isXML` | Type guards |
| `As<T>(value)`, `DevNull(...args)` | A cast for the type checker only; a function that ignores its arguments |

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

The type guards (`is…`) return `false` instead of throwing; the other helpers throw standard JavaScript errors
(`RangeError`, `TypeError`), and `templating()` throws a `MissingValueError`.
