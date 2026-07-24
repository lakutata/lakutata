import {createHash} from 'node:crypto'

//Self-implemented on node:crypto (replaces the `object-hash` package dependency).
//Produces a deterministic hash regardless of object key insertion order.

type HashName = 'md5' | 'sha1' | 'sha224' | 'sha256' | 'sha384' | 'sha512' | 'ripemd160' | string

export type ObjectHashOptions = {
    encoding?: 'hex' | 'binary' | 'base64' | undefined
    algorithm?: HashName | 'passthrough' | undefined
    excludeKeys?: ((key: string) => boolean) | undefined
    excludeValues?: boolean | undefined
    ignoreUnknown?: boolean | undefined
    replacer?: ((value: any) => any) | undefined
    respectFunctionNames?: boolean | undefined
    respectFunctionProperties?: boolean | undefined
    respectType?: boolean | undefined
    unorderedArrays?: boolean | undefined
    unorderedObjects?: boolean | undefined
    unorderedSets?: boolean | undefined
}

const canonicalize = (value: any, opts?: ObjectHashOptions): string => {
    if (value === null) return 'n'
    if (value === undefined) return 'u'
    const t = typeof value
    if (t === 'string') return 's:' + value
    if (t === 'number' || t === 'bigint') return 'n:' + String(value)
    if (t === 'boolean') return 'b:' + value
    if (t === 'function') return 'f:' + (value.name || 'anon')
    if (t === 'symbol') return 'y:' + value.toString()
    if (value instanceof Date) return 'd:' + value.getTime()
    if (value instanceof Set) return 'S:[' + [...value].map(v => canonicalize(v, opts)).sort().join(',') + ']'
    if (value instanceof Map) {
        const entries = [...value.entries()].sort((a, b) => canonicalize(a[0], opts) < canonicalize(b[0], opts) ? -1 : 1)
        return 'M:[' + entries.map(([k, v]) => canonicalize(k, opts) + '>' + canonicalize(v, opts)).join(',') + ']'
    }
    if (Array.isArray(value)) {
        const items = opts?.unorderedArrays ? [...value].map(v => canonicalize(v, opts)).sort() : value.map(v => canonicalize(v, opts))
        return '[' + items.join(',') + ']'
    }
    //Plain object: sort keys for deterministic output (unorderedObjects default true)
    const keys = Object.keys(value)
        .filter(k => !opts?.excludeKeys?.(k))
        .sort()
    const prefix = opts?.excludeValues ? '' : ':'
    return '{' + keys.map(k => k + prefix + (opts?.excludeValues ? '' : canonicalize(value[k], opts))).join(',') + '}'
}

/**
 * Generate an object hash
 * @param value
 * @param options
 * @constructor
 */
export function ObjectHash(value: any, options?: ObjectHashOptions): string {
    if (options?.algorithm === 'passthrough') return typeof value === 'string' ? value : canonicalize(value, options)
    const algorithm: string = options?.algorithm || 'sha1'
    const encoding: 'hex' | 'base64' | 'binary' = options?.encoding || 'hex'
    const str: string = canonicalize(value, options)
    return createHash(algorithm).update(str).digest(encoding as any)
}
