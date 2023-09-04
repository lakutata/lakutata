# Framework Utility Functions

## How to Use

    import {[HelperFunctionName]} from 'lakutata/helper'

## Function List

### `ObjectToMap`

Convert object to Map

- `obj`: `Record<K, V>` - The object to be converted

### `GetPort`

Choose an unused network port

- `options?`: `{ port?: number | number[]; exclude?: Iterable<number> }` - Optional parameter object

### `IsEqual`

Check if two input values are equal

- `val1`: `any` - The first value
- `val2`: `any` - The second value

### `IsPath`

Check if the input content is a path

- `inp`: `string | PathLike` - The content to be checked

### `ConvertToIterable`

Convert the input object to a generator object

- `inp`: `string | Buffer | NodeJS.TypedArray` - The object to be converted

### `ConvertToStream`

Convert Buffer to a readable stream

- `inp`: `Buffer` - The Buffer object to be converted
- `options?`: `ReadableOptions` - Optional parameter object

Convert a TypedArray to a readable stream

- `inp`: `NodeJS.TypedArray` - The TypedArray object to be converted
- `options?`: `ReadableOptions` - Optional parameter object

Convert a string to a readable stream

- `inp`: `string` - The string to be converted
- `options?`: `ReadableOptions` - Optional parameter object

### `IsPromise`

Determine whether a target object is a Promise

- `target`: `any` - The target object to be checked

### `IsPromiseLike`

Determine if a target object is Promise-like

- `target`: `any` - The target object to be checked

### `Delay`

Asynchronous wait

- `ms`: `number` - Waiting time (in milliseconds)

### `DevNull`

The passed-in parameter will have no effect

- `args`: `any[]` - The passed-in parameters

### `ThrowIntoBlackHole`

The passed-in parameter will have no effect

- `args`: `any[]` - The passed-in parameters

### `IsObjectInitialized`

Whether the object has been initialized

- `obj`: `T` - The object to be checked

### `MergeSet`

Merge two sets

- `s1`: `Set<T>` - The first set object
- `s2`: `Set<U>` - The second set object

### `MergeArray`

Merge two arrays

- `arr1`: `T[]` - The first array
- `arr2`: `U[]` - The second array

### `MergeMap`

Merge two maps

- `m1`: `Map<K1, V1>` - The first Map object
- `m2`: `Map<K2, V2>` - The second Map object

### `SetToArray`

Set to Array

- `set`: `Set<T>` - The set object to be converted

### `ArrayToSet`

Array to Set

- `arr`: `T[]` - The array to be converted

### `UniqueArray`

Array deduplication

- `arr`: `T[]` - The array to be deduplicated

### `SortArray`

Array sorting

- `arr`: `T[]` - The array to be sorted
- `options`: `ISortArrayOptions<T>[]` - Optional array of sorting options

### `SortObject`

Object sorting

- `object`: `T` - The object to be sorted
- `options?`: `ISortObjectOptions` - Optional sorting options object

### `ConfigureObjectProperties`

Configure object properties

- `target`: `T` - The object whose properties need to be configured
- `properties`: `Record<string, any>` - The property object

### `As`

Type conversion

- `inp`: `any` - The object to be converted

### `IsGlobString`

Determine if it is a wildcard matching operator string

- `inp`: `string` - The string to be checked

### `RandomString`

Generate a random string

- `length?`: `number` - String length
- `charset?`: `string | string[]` - Character set

### `NonceStr`

Generate a 32-character random string

### `ParentConstructor`

Retrieve the constructor of the parent class inherited by a class instance/constructor function

- `target`: `Function` - The class instance or constructor function
