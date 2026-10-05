//Derived from the upstream projects listed in THIRD_PARTY_NOTICES.md (rewritten in TypeScript)
const MAXIMUM_DEPTH: number = 5

const MAXIMUM_BREADTH: number = 100

const TypedArrayToStringTag: (this: unknown) => string | undefined = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Int8Array.prototype), Symbol.toStringTag)!.get!

/**
 * The count of the omitted items
 * @param count
 */
function itemCount(count: number): string {
    return count === 1 ? '1 item' : `${count} items`
}

/**
 * Serialize a value which JSON cannot (circular references, bigints):
 * sorted keys, circular references as "[Circular]", limited depth and breadth
 * @param key
 * @param value
 * @param stack
 */
function safeStringify(key: string, value: any, stack: object[]): string | undefined {
    switch (typeof value) {
        case 'string':
            return JSON.stringify(value)
        case 'number':
            return isFinite(value) ? String(value) : 'null'
        case 'boolean':
            return value ? 'true' : 'false'
        case 'bigint':
            return String(value)
        case 'object': {
            if (value === null) return 'null'
            if (typeof value.toJSON === 'function') {
                value = value.toJSON(key)
                if (typeof value !== 'object') return safeStringify(key, value, stack)
                if (value === null) return 'null'
            }
            if (stack.includes(value)) return '"[Circular]"'
            let result: string = ''
            if (Array.isArray(value)) {
                if (!value.length) return '[]'
                if (MAXIMUM_DEPTH < stack.length + 1) return '"[Array]"'
                stack.push(value)
                const count: number = Math.min(value.length, MAXIMUM_BREADTH)
                for (let index: number = 0; index < count; index++) {
                    result += `${index ? ',' : ''}${safeStringify(String(index), value[index], stack) ?? 'null'}`
                }
                if (value.length - 1 > MAXIMUM_BREADTH) result += `,"... ${itemCount(value.length - MAXIMUM_BREADTH - 1)} not stringified"`
                stack.pop()
                return `[${result}]`
            }
            let keys: string[] = Object.keys(value)
            const keyCount: number = keys.length
            if (!keyCount) return '{}'
            if (MAXIMUM_DEPTH < stack.length + 1) return '"[Object]"'
            let separator: string = ''
            let count: number = Math.min(keyCount, MAXIMUM_BREADTH)
            if (value.length !== undefined && TypedArrayToStringTag.call(value) !== undefined && value.length !== 0) {
                const items: number = Math.min(value.length, MAXIMUM_BREADTH)
                for (let index: number = 0; index < items; index++) result += `${index ? ',' : ''}"${index}":${value[index]}`
                keys = keys.slice(value.length)
                count -= value.length
                separator = ','
            }
            keys.sort()
            stack.push(value)
            for (let index: number = 0; index < count; index++) {
                const item: string | undefined = safeStringify(keys[index], value[keys[index]], stack)
                if (item === undefined) continue
                result += `${separator}${JSON.stringify(keys[index])}:${item}`
                separator = ','
            }
            if (keyCount > MAXIMUM_BREADTH) result += `${separator}"...":"${itemCount(keyCount - MAXIMUM_BREADTH)} not stringified"`
            stack.pop()
            return `{${result}}`
        }
        default:
            return undefined
    }
}

/**
 * Serialize a value to JSON, the values JSON cannot serialize are serialized safely
 * @param value
 */
export function stringify(value: unknown): string | undefined {
    try {
        return JSON.stringify(value)
    } catch {
        try {
            return safeStringify('', value, [])
        } catch {
            return '"[unable to serialize, circular reference is too complex to analyze]"'
        }
    }
}
