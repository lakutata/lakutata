/**
 * The nesting levels of a subject flattened: deeper than the patterns may be (2 levels)
 */
const MAX_DEPTH: number = 3

/**
 * Whether a value is a plain object, whose properties a pattern compares one by one
 * @param value
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
    const prototype: unknown = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

/**
 * A pattern with the properties of its nested objects as keys joined by dots (`{res: {name: 'user'}}` gives
 * `{'res.name': 'user'}`): their values are compared one by one, not as the text of their object. An empty nested
 * object stays a value.
 * @param pattern
 * @param prefix
 */
export function flattenPattern(pattern: Record<string, any>, prefix: string = ''): Record<string, any> {
    const flat: Record<string, any> = {}
    for (const [key, value] of Object.entries(pattern)) {
        if (isPlainObject(value) && Object.keys(value).length) {
            Object.assign(flat, flattenPattern(value, `${prefix}${key}.`))
        } else {
            flat[`${prefix}${key}`] = value
        }
    }
    return flat
}

/**
 * A subject matched by the flattened patterns: its own properties, with the ones of its nested objects as keys joined
 * by dots
 * @param subject
 */
export function flattenSubject(subject: Record<string, any>): Record<string, any> {
    if (!isPlainObject(subject)) return subject
    const flat: Record<string, any> = {...subject}
    const add = (object: Record<string, any>, prefix: string, depth: number): void => {
        for (const [key, value] of Object.entries(object)) {
            if (!isPlainObject(value)) continue
            for (const [nestedKey, nestedValue] of Object.entries(value)) flat[`${prefix}${key}.${nestedKey}`] = nestedValue
            if (depth < MAX_DEPTH) add(value, `${prefix}${key}.`, depth + 1)
        }
    }
    add(subject, '', 1)
    return flat
}
