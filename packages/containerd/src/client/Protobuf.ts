/**
 * The types of the fields of protobuf read and written: the scalar ones, the messages (their definition)
 */
export type ScalarType = 'string' | 'bytes' | 'bool' | 'int32' | 'int64' | 'uint32' | 'uint64' | 'enum'

/**
 * A field of a message: its number, its type, repeated (packed for the scalar numbers, as proto3 writes them), or a map
 * (its keys strings)
 */
export type Field = {
    no: number
    type: ScalarType | Schema
    repeated?: boolean
    map?: boolean
}

/**
 * The definition of a message: its fields by their names (the ones of the messages decoded and encoded)
 */
export type Schema = { readonly [name: string]: Field }

/**
 * A message decoded: its fields by their names (the missing ones are not set)
 */
export type Message = Record<string, any>

/**
 * The types of the wire of protobuf
 */
const enum WireType {
    VARINT = 0,
    FIXED64 = 1,
    LENGTH = 2,
    FIXED32 = 5
}

/**
 * The scalar types written as varints
 */
const VARINTS: ReadonlySet<string> = new Set(['bool', 'int32', 'int64', 'uint32', 'uint64', 'enum'])

/**
 * Write a varint: the numbers up to 2^53 (the sizes, the offsets), the bigints on 64 bits (the times in nanoseconds), the
 * negative ones as the ten bytes of their 64 bits
 * @param bytes
 * @param value
 */
function WriteVarint(bytes: number[], value: number | bigint): void {
    if (typeof value === 'bigint' || value < 0) {
        //Two's complement on 64 bits
        let big: bigint = BigInt.asUintN(64, typeof value === 'bigint' ? value : BigInt(Math.trunc(value)))
        while (big > 0x7fn) {
            bytes.push(Number(big & 0x7fn) | 0x80)
            big >>= 7n
        }
        bytes.push(Number(big))
        return
    }
    let rest: number = Math.trunc(value)
    while (rest > 0x7f) {
        bytes.push((rest % 0x80) | 0x80)
        rest = Math.floor(rest / 0x80)
    }
    bytes.push(rest)
}

/**
 * Read a varint: a number (exact up to 2^53), the negative int64 and int32 as such
 * @param buffer
 * @param position
 */
function ReadVarint(buffer: Uint8Array, position: { offset: number }): number {
    let result: bigint = 0n
    let shift: bigint = 0n
    for (; ;) {
        if (position.offset >= buffer.length) throw new Error('The protobuf message is truncated (varint)')
        const byte: number = buffer[position.offset++]
        result |= BigInt(byte & 0x7f) << shift
        if (!(byte & 0x80)) break
        shift += 7n
        if (shift > 63n) throw new Error('The protobuf message has a varint longer than 64 bits')
    }
    return Number(BigInt.asIntN(64, result))
}

/**
 * A length-delimited field: its tag, its length, its bytes
 * @param bytes
 * @param no
 * @param data
 */
function WriteLength(bytes: number[], no: number, data: Uint8Array): void {
    WriteVarint(bytes, no * 8 + WireType.LENGTH)
    WriteVarint(bytes, data.length)
    for (const byte of data) bytes.push(byte)
}

/**
 * Write a value of a field (not repeated, not a map)
 * @param bytes
 * @param field
 * @param value
 */
function WriteValue(bytes: number[], field: Field, value: unknown): void {
    if (typeof field.type === 'object') return WriteLength(bytes, field.no, Encode(field.type, value as Message))
    if (field.type === 'string') return WriteLength(bytes, field.no, Buffer.from(String(value), 'utf8'))
    if (field.type === 'bytes') return WriteLength(bytes, field.no, value instanceof Uint8Array ? value : Buffer.from(value as string))
    WriteVarint(bytes, field.no * 8 + WireType.VARINT)
    WriteVarint(bytes, field.type === 'bool' ? (value ? 1 : 0) : typeof value === 'bigint' ? value : Number(value))
}

/**
 * Whether a value is the default one of its type, which proto3 does not write
 * @param field
 * @param value
 */
function IsDefault(field: Field, value: unknown): boolean {
    if (value === undefined || value === null) return true
    if (typeof field.type === 'object') return false
    if (field.type === 'string') return value === ''
    if (field.type === 'bytes') return (value as Uint8Array).length === 0
    if (field.type === 'bool') return !value
    return Number(value) === 0
}

/**
 * Encode a message
 * @param schema
 * @param message
 */
export function Encode(schema: Schema, message: Message = {}): Uint8Array {
    const bytes: number[] = []
    for (const [name, field] of Object.entries(schema).sort(([, a], [, b]): number => a.no - b.no)) {
        const value: unknown = message[name]
        if (value === undefined || value === null) continue
        if (field.map) {
            //The entries: a message of a key (1) and a value (2)
            const entry: Schema = {key: {no: 1, type: 'string'}, value: {no: 2, type: field.type}}
            for (const [key, item] of Object.entries(value as Record<string, unknown>)) WriteLength(bytes, field.no, Encode(entry, {key: key, value: item}))
            continue
        }
        if (field.repeated) {
            const items: unknown[] = value as unknown[]
            if (!items.length) continue
            if (typeof field.type === 'string' && VARINTS.has(field.type)) {
                //Packed
                const packed: number[] = []
                for (const item of items) WriteVarint(packed, field.type === 'bool' ? (item ? 1 : 0) : typeof item === 'bigint' ? item : Number(item))
                WriteLength(bytes, field.no, Uint8Array.from(packed))
            } else {
                for (const item of items) WriteValue(bytes, field, item)
            }
            continue
        }
        if (IsDefault(field, value)) continue
        WriteValue(bytes, field, value)
    }
    return Uint8Array.from(bytes)
}

/**
 * Read a value of a field
 * @param field
 * @param wire
 * @param buffer
 * @param position
 */
function ReadValue(field: Field, wire: number, buffer: Uint8Array, position: { offset: number }): unknown {
    if (wire === WireType.VARINT) {
        const value: number = ReadVarint(buffer, position)
        if (field.type === 'bool') return value !== 0
        if (field.type === 'uint32') return value >>> 0
        if (field.type === 'int32') return value | 0
        return value
    }
    if (wire === WireType.LENGTH) {
        const length: number = ReadVarint(buffer, position)
        const data: Uint8Array = buffer.subarray(position.offset, position.offset + length)
        if (data.length < length) throw new Error('The protobuf message is truncated')
        position.offset += length
        if (typeof field.type === 'object') return Decode(field.type, data)
        if (field.type === 'string') return Buffer.from(data).toString('utf8')
        return Buffer.from(data)
    }
    throw new Error(`The protobuf field ${field.no} has the wire type ${wire}, which the schema does not expect`)
}

/**
 * Skip a field the schema does not know
 * @param wire
 * @param buffer
 * @param position
 */
function Skip(wire: number, buffer: Uint8Array, position: { offset: number }): void {
    if (wire === WireType.VARINT) ReadVarint(buffer, position)
    else if (wire === WireType.FIXED64) position.offset += 8
    else if (wire === WireType.FIXED32) position.offset += 4
    else if (wire === WireType.LENGTH) {
        //The length read before the offset is taken (reading it moves the offset)
        const length: number = ReadVarint(buffer, position)
        position.offset += length
    }
    else throw new Error(`The protobuf message has the unknown wire type ${wire}`)
}

/**
 * Decode a message: the fields of the schema, the others skipped; the repeated ones are arrays (empty without items),
 * the maps objects
 * @param schema
 * @param buffer
 */
export function Decode(schema: Schema, buffer: Uint8Array): Message {
    const byNumber: Map<number, [string, Field]> = new Map(Object.entries(schema).map(([name, field]): [number, [string, Field]] => [field.no, [name, field]]))
    const message: Message = {}
    for (const [name, field] of Object.entries(schema)) {
        if (field.map) message[name] = {}
        else if (field.repeated) message[name] = []
    }
    const position: { offset: number } = {offset: 0}
    while (position.offset < buffer.length) {
        const tag: number = ReadVarint(buffer, position)
        const no: number = Math.floor(tag / 8)
        const wire: number = tag % 8
        const known: [string, Field] | undefined = byNumber.get(no)
        if (!known) {
            Skip(wire, buffer, position)
            continue
        }
        const [name, field] = known
        if (field.map) {
            const entry: Message = ReadValue({no: no, type: {key: {no: 1, type: 'string'}, value: {no: 2, type: field.type}}}, wire, buffer, position) as Message
            message[name][entry.key ?? ''] = entry.value ?? (typeof field.type === 'object' ? {} : field.type === 'string' ? '' : 0)
        } else if (field.repeated && wire === WireType.LENGTH && typeof field.type === 'string' && VARINTS.has(field.type)) {
            //Packed
            const length: number = ReadVarint(buffer, position)
            const end: number = position.offset + length
            while (position.offset < end) message[name].push(ReadValue(field, WireType.VARINT, buffer, position))
        } else if (field.repeated) {
            message[name].push(ReadValue(field, wire, buffer, position))
        } else {
            message[name] = ReadValue(field, wire, buffer, position)
        }
    }
    return message
}
