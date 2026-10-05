import {createHash, getHashes, type Hash} from 'node:crypto'

/**
 * Derived from index.js of object-hash 3.0.0 (MIT, see THIRD_PARTY_NOTICES.md): the hashes of 2.x
 */

type HashName = 'md5' | 'sha1' | 'sha224' | 'sha256' | 'sha384' | 'sha512' | 'ripemd160' | string

/**
 * The options of `objectHash`: the digest, and what the hash takes into account.
 */
export type ObjectHashOptions = {
    /**
     * How the digest is written: `'hex'`, `'base64'` or `'binary'` (a Latin-1 string). `'buffer'` is accepted too
     * (returning a `Buffer` typed as a string). Ignored by the `'passthrough'` algorithm.
     * @default 'hex'
     */
    encoding?: 'hex' | 'binary' | 'base64' | undefined
    /**
     * The hash algorithm: a name of `crypto.getHashes()` (`'md5'`, `'sha1'`, `'sha256'`, `'sha512'`…), in any case, or
     * `'passthrough'` to get the serialization itself (to see what the hash depends on).
     * @default 'sha1'
     */
    algorithm?: HashName | 'passthrough' | undefined
    /**
     * Leave out the object properties whose key it returns `true` for, at any depth (`(key) => key === 'updatedAt'`).
     * @default none (every key counts)
     */
    excludeKeys?: ((key: string) => boolean) | undefined
    /**
     * Whether only the keys count, not their values: two objects of the same shape get the same hash.
     * @default false
     */
    excludeValues?: boolean | undefined
    /**
     * Whether a value of an unsupported type (a `Promise`, a `WeakMap`, a `Blob`) is hashed as its type name only,
     * instead of throwing.
     * @default false
     */
    ignoreUnknown?: boolean | undefined
    /**
     * Replace each value before it is hashed, at any depth (`(value) => value instanceof Date ? value.getTime() :
     * value`).
     * @default none
     */
    replacer?: ((value: any) => any) | undefined
    /**
     * Whether a function's name counts, besides its source code.
     * @default true
     */
    respectFunctionNames?: boolean | undefined
    /**
     * Whether the properties of a function count (its static members).
     * @default true
     */
    respectFunctionProperties?: boolean | undefined
    /**
     * Whether an object's prototype and constructor count: with `false`, an instance and a plain object of the same
     * properties get the same hash.
     * @default true
     */
    respectType?: boolean | undefined
    /**
     * Whether the order of the array items does not count (`[1, 2]` and `[2, 1]` get the same hash).
     * @default false
     */
    unorderedArrays?: boolean | undefined
    /**
     * Whether the order of the object keys does not count (`{a, b}` and `{b, a}` get the same hash).
     * @default true
     */
    unorderedObjects?: boolean | undefined
    /**
     * Whether the insertion order of the `Set` and `Map` entries does not count.
     * @default true
     */
    unorderedSets?: boolean | undefined
}

/**
 * The options with their defaults
 */
type HashingOptions = {
    algorithm: string
    encoding: string
    excludeValues: boolean
    ignoreUnknown: boolean
    respectType: boolean
    respectFunctionNames: boolean
    respectFunctionProperties: boolean
    unorderedArrays: boolean
    unorderedSets: boolean
    unorderedObjects: boolean
    replacer?: (value: any) => any
    excludeKeys?: (key: string) => boolean
}

/**
 * Where the serialization is written: a hash, or a string (passthrough, the entries of the unordered arrays)
 */
type Output = {
    write(chunk: string | Buffer): void
}

const HASHES: string[] = [...getHashes(), 'passthrough']

const ENCODINGS: string[] = ['buffer', 'hex', 'binary', 'base64']

function ApplyDefaults(object: any, source: ObjectHashOptions = {}): HashingOptions {
    const options: HashingOptions = {
        algorithm: (source.algorithm || 'sha1').toLowerCase(),
        encoding: (source.encoding || 'hex').toLowerCase(),
        excludeValues: !!source.excludeValues,
        ignoreUnknown: source.ignoreUnknown === true,
        respectType: source.respectType !== false,
        respectFunctionNames: source.respectFunctionNames !== false,
        respectFunctionProperties: source.respectFunctionProperties !== false,
        unorderedArrays: source.unorderedArrays === true,
        unorderedSets: source.unorderedSets !== false,
        unorderedObjects: source.unorderedObjects !== false,
        replacer: source.replacer || undefined,
        excludeKeys: source.excludeKeys || undefined
    }
    if (typeof object === 'undefined') throw new Error('Object argument required.')
    //A case-insensitive match in the hashes is accepted (SHA256 for sha256)
    for (const name of HASHES) if (name.toLowerCase() === options.algorithm.toLowerCase()) options.algorithm = name
    if (!HASHES.includes(options.algorithm)) throw new Error(`Algorithm "${options.algorithm}"  not supported. supported values: ${HASHES.join(', ')}`)
    if (!ENCODINGS.includes(options.encoding) && options.algorithm !== 'passthrough') throw new Error(`Encoding "${options.encoding}"  not supported. supported values: ${ENCODINGS.join(', ')}`)
    return options
}

function isNativeFunction(f: unknown): boolean {
    if (typeof f !== 'function') return false
    return /^function\s+\w*\s*\(\s*\)\s*{\s+\[native code\]\s+}$/i.exec(Function.prototype.toString.call(f)) != null
}

/**
 * A string output (the PassThrough of the upstream): a Buffer written is added as its UTF-8 text
 */
class StringOutput implements Output {
    public text: string = ''

    public write(chunk: string | Buffer): void {
        this.text += chunk
    }
}

/**
 * The serializer of the values: writes the serialization of a value to the output
 */
class TypeHasher {

    constructor(protected readonly options: HashingOptions, protected readonly output: Output, protected context: any[] = []) {
    }

    protected write(chunk: string | Buffer): void {
        this.output.write(chunk)
    }

    public dispatch(value: any): void {
        if (this.options.replacer) value = this.options.replacer(value)
        const type: string = value === null ? 'null' : typeof value
        switch (type) {
            case 'object':
                return this.object(value)
            case 'function':
                return this.function(value)
            case 'string':
                return this.string(value)
            case 'number':
                return this.write('number:' + value.toString())
            case 'boolean':
                return this.write('bool:' + value.toString())
            case 'bigint':
                return this.write('bigint:' + value.toString())
            case 'symbol':
                return this.write('symbol:' + value.toString())
            case 'null':
                return this.write('Null')
            default:
                return this.write('Undefined')
        }
    }

    protected string(value: string): void {
        this.write('string:' + value.length + ':')
        this.write(value.toString())
    }

    protected function(fn: Function): void {
        this.write('fn:')
        this.dispatch(isNativeFunction(fn) ? '[native]' : fn.toString())
        //The native functions are distinguished by their names, or String and Function would have the same hash
        if (this.options.respectFunctionNames !== false) this.dispatch('function-name:' + String(fn.name))
        if (this.options.respectFunctionProperties) this.object(fn)
    }

    protected object(object: any): void {
        const objString: string = Object.prototype.toString.call(object)
        const matched: RegExpExecArray | null = /\[object (.*)\]/i.exec(objString)
        const objType: string = (matched ? matched[1] : `unknown:[${objString}]`).toLowerCase()
        const objectNumber: number = this.context.indexOf(object)
        if (objectNumber >= 0) return this.dispatch('[CIRCULAR:' + objectNumber + ']')
        this.context.push(object)
        if (Buffer.isBuffer(object)) {
            this.write('buffer:')
            return this.write(object)
        }
        if (objType !== 'object' && objType !== 'function' && objType !== 'asyncfunction') {
            if (!this.special(objType, object)) {
                if (this.options.ignoreUnknown) return this.write('[' + objType + ']')
                throw new Error('Unknown object type "' + objType + '"')
            }
            return
        }
        let keys: string[] = Object.keys(object)
        if (this.options.unorderedObjects) keys = keys.sort()
        //The special properties distinguish the types (new Foo, new Bar), not for the native functions
        if (this.options.respectType !== false && !isNativeFunction(object)) keys.splice(0, 0, 'prototype', '__proto__', 'constructor')
        if (this.options.excludeKeys) keys = keys.filter((key: string): boolean => !this.options.excludeKeys!(key))
        this.write('object:' + keys.length + ':')
        for (const key of keys) {
            this.dispatch(key)
            this.write(':')
            if (!this.options.excludeValues) this.dispatch(object[key])
            this.write(',')
        }
    }

    /**
     * The object types serialized by their own way: whether the type is known
     * @param type
     * @param object
     */
    protected special(type: string, object: any): boolean {
        switch (type) {
            case 'array':
                this.array(object)
                return true
            case 'date':
                this.write('date:' + object.toJSON())
                return true
            case 'symbol':
                this.write('symbol:' + object.toString())
                return true
            case 'error':
                this.write('error:' + object.toString())
                return true
            case 'boolean':
                this.write('bool:' + object.toString())
                return true
            case 'string':
                this.string(object)
                return true
            case 'function':
                this.function(object)
                return true
            case 'number':
                this.write('number:' + object.toString())
                return true
            case 'xml':
                this.write('xml:' + object.toString())
                return true
            case 'null':
                this.write('Null')
                return true
            case 'undefined':
                this.write('Undefined')
                return true
            case 'regexp':
                this.write('regex:' + object.toString())
                return true
            case 'uint8array':
            case 'uint8clampedarray':
            case 'int8array':
            case 'uint16array':
            case 'int16array':
            case 'uint32array':
            case 'int32array':
            case 'float32array':
            case 'float64array':
                this.write(type + ':')
                this.dispatch(Array.prototype.slice.call(object))
                return true
            case 'arraybuffer':
                this.write('arraybuffer:')
                this.dispatch(new Uint8Array(object))
                return true
            case 'url':
                this.write('url:' + object.toString())
                return true
            case 'map':
                this.write('map:')
                this.array(Array.from(object), this.options.unorderedSets !== false)
                return true
            case 'set':
                this.write('set:')
                this.array(Array.from(object), this.options.unorderedSets !== false)
                return true
            case 'file':
                this.write('file:')
                //Like upstream: "lastModfied"
                this.dispatch([object.name, object.size, object.type, object.lastModfied])
                return true
            case 'blob':
                if (this.options.ignoreUnknown) {
                    this.write('[blob]')
                    return true
                }
                throw Error('Hashing Blob objects is currently not supported\n(see https://github.com/puleos/object-hash/issues/26)\nUse "options.replacer" or "options.ignoreUnknown"\n')
            case 'bigint':
                this.write('bigint:' + object.toString())
                return true
            case 'domwindow':
            case 'process':
            case 'timer':
            case 'pipe':
            case 'tcp':
            case 'udp':
            case 'tty':
            case 'statwatcher':
            case 'securecontext':
            case 'connection':
            case 'zlib':
            case 'context':
            case 'nodescript':
            case 'httpparser':
            case 'dataview':
            case 'signal':
            case 'fsevent':
            case 'tlswrap':
                this.write(type)
                return true
            default:
                return false
        }
    }

    protected array(array: any[], unordered: boolean = this.options.unorderedArrays !== false): void {
        this.write('array:' + array.length + ':')
        if (!unordered || array.length <= 1) {
            for (const entry of array) this.dispatch(entry)
            return
        }
        //The entries are serialized and sorted: each one with a copy of the context, the order must not matter; the
        //objects they add to their copies are added to the context afterwards
        let contextAdditions: any[] = []
        const entries: string[] = array.map((entry: any): string => {
            const output: StringOutput = new StringOutput()
            const localContext: any[] = this.context.slice()
            new TypeHasher(this.options, output, localContext).dispatch(entry)
            contextAdditions = contextAdditions.concat(localContext.slice(this.context.length))
            return output.text
        })
        this.context = this.context.concat(contextAdditions)
        entries.sort()
        this.array(entries, false)
    }
}

/**
 * Hash any value by its content: two values which are deeply equal get the same hash, whatever their identity or the
 * order of their keys (a cache key, a change detection, a deduplication). The value is serialized with its types
 * (`1` and `'1'` differ, and so do two classes with the same properties), then hashed.
 *
 * Supported: the primitives, plain objects and class instances (their own enumerable string keys; the symbol keys are
 * ignored), arrays, `Date` (an invalid date too), `RegExp`, `Error` (its `toString()`), `Map` and `Set`, `URL`, the
 * typed arrays, `ArrayBuffer`, `Buffer` and functions (their source code). A circular reference is hashed as a
 * reference, not followed.
 * @param value The value to hash; it must not be `undefined`.
 * @param options The algorithm and the encoding of the digest, and what counts in the hash.
 * @returns The digest, in hexadecimal by default (a SHA-1: 40 characters); the serialization with the `'passthrough'`
 * algorithm.
 * @throws {Error} When `value` is `undefined`, when the algorithm or the encoding is not supported, or when the value
 * contains an unsupported type (a `Promise`, a `WeakMap`, a `Blob`…) without `ignoreUnknown`.
 * @example
 * ```typescript
 * import {objectHash} from 'lakutata/utils'
 *
 * console.log(objectHash({a: 1, b: [1, 2]}) === objectHash({b: [1, 2], a: 1}))
 * //true
 * console.log(objectHash([1, 2]) === objectHash([2, 1]))
 * //false
 * console.log(objectHash([1, 2], {unorderedArrays: true}) === objectHash([2, 1], {unorderedArrays: true}))
 * //true
 * //A cache key ignoring the timestamps
 * const key: string = objectHash({query: 'books', at: Date.now()}, {
 *     algorithm: 'sha256',
 *     excludeKeys: (name: string): boolean => name === 'at'
 * })
 * console.log(key.length)
 * //64
 * ```
 */
export function objectHash(value: any, options?: ObjectHashOptions): string {
    const hashingOptions: HashingOptions = ApplyDefaults(value, options)
    if (hashingOptions.algorithm === 'passthrough') {
        const output: StringOutput = new StringOutput()
        new TypeHasher(hashingOptions, output).dispatch(value)
        return output.text
    }
    const hash: Hash = createHash(hashingOptions.algorithm)
    new TypeHasher(hashingOptions, {write: (chunk: string | Buffer): unknown => typeof chunk === 'string' ? hash.update(chunk, 'utf8') : hash.update(chunk)}).dispatch(value)
    return hashingOptions.encoding === 'buffer' ? hash.digest() as unknown as string : hash.digest(hashingOptions.encoding as 'hex')
}
