import {DTO, type Schema} from '@lakutata/core'
import {DBusSignedValue} from 'dbus-sdk'

/**
 * The DBus signature of the values of a schema: an object is a dictionary of variants,
 * the scalars have their own types, the other values are variants
 * @param schema
 */
export function SchemaSignature(schema: Schema | typeof DTO): string {
    const target: any = typeof schema === 'function' ? (schema as typeof DTO).Schema() : schema
    switch (target?.type) {
        case 'object':
            return 'a{sv}'
        case 'string':
            return 's'
        case 'boolean':
            return 'b'
        case 'number':
            return (target._rules ?? []).some((rule: { name?: string }): boolean => rule.name === 'integer') ? 'x' : 'd'
        case 'bigint':
            return 'x'
        case 'array':
            return 'av'
        default:
            return 'v'
    }
}

/**
 * A value ready to be encoded: the dates are ISO strings, the undefined and null values are removed (a variant has no null);
 * the typed values of dbus-sdk (`DBusUInt32`, `DBusVariant`…) are kept as they are, a Map keeps its entries (its keys
 * keep their types)
 * @param value
 */
export function Encodable(value: unknown): unknown {
    if (value instanceof Date) return value.toISOString()
    if (value instanceof DBusSignedValue) return value
    if (Array.isArray(value)) return value.filter((item: unknown): boolean => item !== undefined && item !== null).map(Encodable)
    if (value instanceof Map) return new Map([...value].filter(([, item]): boolean => item !== undefined && item !== null).map(([key, item]): [unknown, unknown] => [key, Encodable(item)]))
    if (value && typeof value === 'object' && !Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
        const encodable: Record<string, unknown> = {}
        for (const [key, item] of Object.entries(value)) if (item !== undefined && item !== null) encodable[key] = Encodable(item)
        return encodable
    }
    return value
}
