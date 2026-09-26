/**
 * Derived from joi 18.0.2 lib/annotate.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {clone, type Indexable, isArray} from '../hoek/index.js'
import * as Common from './common.js'
import type {ErrorDetail, PathKey} from './model.js'

const annotations: unique symbol = Symbol('annotations')

interface Annotations {
    errors: Record<string, number[]>
    missing: Record<string, number>
}

type Annotated = Indexable & { [annotations]?: Annotations }

/**
 * The validation error annotate() is called on
 */
export interface AnnotatedError {
    _original: unknown
    details: ErrorDetail[]
}

/**
 * Render the validated value with the errors marked in place (ValidationError.annotate())
 * @param stripColorCodes
 */
export function error(this: AnnotatedError, stripColorCodes?: boolean): string {
    if (!this._original || typeof this._original !== 'object') return this.details[0].message
    const redFgEscape: string = stripColorCodes ? '' : '\u001b[31m'
    const redBgEscape: string = stripColorCodes ? '' : '\u001b[41m'
    const endColor: string = stripColorCodes ? '' : '\u001b[0m'
    const obj: unknown = clone(this._original)
    //Reverse order to process deepest child first
    for (let i: number = this.details.length - 1; i >= 0; --i) {
        const pos: number = i + 1
        const error: ErrorDetail = this.details[i]
        const path: PathKey[] = error.path
        let node: Annotated = obj as Annotated
        for (let j: number = 0; ; ++j) {
            const seg: PathKey = path[j]
            //joi schemas are not cloned by hoek, we have to take this extra step
            if (Common.isSchema(node)) node = (node as unknown as { clone(): Annotated }).clone()
            if (j + 1 < path.length && typeof node[seg] !== 'string') {
                node = node[seg] as Annotated
            } else {
                const refAnnotations: Annotations = node[annotations] || {errors: {}, missing: {}}
                node[annotations] = refAnnotations
                const cacheKey: PathKey = seg || (error.context?.key as PathKey)
                if (node[seg] !== undefined) {
                    refAnnotations.errors[cacheKey] = refAnnotations.errors[cacheKey] || []
                    refAnnotations.errors[cacheKey].push(pos)
                } else {
                    refAnnotations.missing[cacheKey] = pos
                }
                break
            }
        }
    }
    const replacers = {
        key: /_\$key\$_([, \d]+)_\$end\$_"/g,
        missing: /"_\$miss\$_([^|]+)\|(\d+)_\$end\$_": "__missing__"/g,
        arrayIndex: /\s*"_\$idx\$_([, \d]+)_\$end\$_",?\n(.*)/g,
        specials: /"\[(NaN|Symbol.*|-?Infinity|function.*|\(.*)]"/g
    }
    let message: string = safeStringify(obj, 2)
        .replace(replacers.key, ($0: string, $1: string): string => `" ${redFgEscape}[${$1}]${endColor}`)
        .replace(replacers.missing, ($0: string, $1: string, $2: string): string => `${redBgEscape}"${$1}"${endColor}${redFgEscape} [${$2}]: -- missing --${endColor}`)
        .replace(replacers.arrayIndex, ($0: string, $1: string, $2: string): string => `\n${$2} ${redFgEscape}[${$1}]${endColor}`)
        .replace(replacers.specials, ($0: string, $1: string): string => $1)
    message = `${message}\n${redFgEscape}`
    for (let i: number = 0; i < this.details.length; ++i) {
        const pos: number = i + 1
        message = `${message}\n[${pos}] ${this.details[i].message}`
    }
    message = message + endColor
    return message
}

//Inspired by json-stringify-safe
function safeStringify(obj: unknown, spaces: number): string {
    return JSON.stringify(obj, serializer(), spaces)
}

type Replacer = (this: unknown, key: string, value: unknown) => unknown

function serializer(): Replacer {
    const keys: string[] = []
    const stack: unknown[] = []
    const cycleReplacer = (key: string, value: unknown): string => {
        if (stack[0] === value) return '[Circular ~]'
        return '[Circular ~.' + keys.slice(0, stack.indexOf(value)).join('.') + ']'
    }
    return function (this: unknown, key: string, value: unknown): unknown {
        if (stack.length > 0) {
            const thisPos: number = stack.indexOf(this)
            if (~thisPos) {
                stack.length = thisPos + 1
                keys.length = thisPos + 1
                keys[thisPos] = key
            } else {
                stack.push(this)
                keys.push(key)
            }
            if (~stack.indexOf(value)) value = cycleReplacer.call(this, key, value)
        } else {
            stack.push(value)
        }
        if (value) {
            const valueAnnotations: Annotations | undefined = (value as Annotated)[annotations]
            if (valueAnnotations) {
                if (isArray(value)) {
                    const annotated: unknown[] = []
                    for (let i: number = 0; i < value.length; ++i) {
                        if (valueAnnotations.errors[i]) annotated.push(`_$idx$_${valueAnnotations.errors[i].sort().join(', ')}_$end$_`)
                        annotated.push(value[i])
                    }
                    value = annotated
                } else {
                    const record: Indexable = value as Indexable
                    for (const errorKey in valueAnnotations.errors) {
                        record[`${errorKey}_$key$_${valueAnnotations.errors[errorKey].sort().join(', ')}_$end$_`] = record[errorKey]
                        record[errorKey] = undefined
                    }
                    for (const missingKey in valueAnnotations.missing) {
                        record[`_$miss$_${missingKey}|${valueAnnotations.missing[missingKey]}_$end$_`] = '__missing__'
                    }
                }
                return value
            }
        }
        if (value === Infinity || value === -Infinity || Number.isNaN(value) || typeof value === 'function' || typeof value === 'symbol') {
            return '[' + (value as { toString(): string }).toString() + ']'
        }
        return value
    }
}
