/**
 * The protobuf scalar types the codec reads and writes; a field holding a message gives its {@link Schema} instead.
 * - `string`: a UTF-8 string.
 * - `bytes`: a `Uint8Array` (or a string, written as UTF-8); decoded as a `Buffer`.
 * - `bool`: a boolean.
 * - `int32`, `uint32`, `int64`, `uint64`, `enum`: varints, written from a `number` (truncated to an integer) or a
 *   `bigint`, decoded as a `number`, or a `bigint` for the 64-bit integers beyond 2^53 (see {@link Decode}).
 *
 * The other protobuf types (`sint32`/`sint64` with their zigzag encoding, `fixed32`, `fixed64`, `sfixed*`, `float`,
 * `double`) are not supported: a schema cannot declare them, and {@link Decode} skips them only as unknown fields.
 */
export type ScalarType = 'string' | 'bytes' | 'bool' | 'int32' | 'int64' | 'uint32' | 'uint64' | 'enum'

/**
 * A field of a protobuf message, as a {@link Schema} declares it.
 */
export type Field = {
    /**
     * The field number of the `.proto` definition (a positive integer).
     */
    no: number
    /**
     * The field's type: a scalar type, or the schema of the message it holds.
     */
    type: ScalarType | Schema
    /**
     * Whether the field is `repeated`: its value is an array. The varint types (numbers, `bool`, `enum`) are written
     * packed, as proto3 does; both the packed and the unpacked forms are read.
     * @default false
     */
    repeated?: boolean
    /**
     * Whether the field is a `map<string, type>`: its value is an object whose keys are the map keys. Only string keys
     * are supported.
     * @default false
     */
    map?: boolean
}

/**
 * The definition of a protobuf message: its fields by the property names they have in the JavaScript objects encoded
 * and decoded. It replaces the `.proto` file and the generated code: write one schema per message used.
 */
export type Schema = { readonly [name: string]: Field }

/**
 * A protobuf message as a JavaScript object: its field values by the names of its {@link Schema}. In a decoded message,
 * the singular fields missing from the bytes are absent (not set to their defaults), the repeated fields are arrays and
 * the maps objects.
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
 * Read a varint as a number (the lengths, the tags), the negative ones as such
 * @param buffer
 * @param position
 */
function ReadVarint(buffer: Uint8Array, position: { offset: number }): number {
    return Number(BigInt.asIntN(64, ReadVarintBits(buffer, position)))
}

/**
 * The 64 bits of a varint, unsigned
 * @param buffer
 * @param position
 */
function ReadVarintBits(buffer: Uint8Array, position: { offset: number }): bigint {
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
    return BigInt.asUintN(64, result)
}

/**
 * A 64-bit integer: a number when it is a safe integer, a bigint beyond (its precision kept)
 * @param value
 */
function Integer64(value: bigint): number | bigint {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value
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
 * Encode a message into protobuf bytes (proto3), the fields in their number order.
 *
 * - The properties `undefined` or `null`, and the properties the schema does not declare, are not written.
 * - A singular scalar field holding its default value (`0`, `''`, `false`, empty bytes) is not written, as proto3 does;
 *   a message field is always written, even empty.
 * - The varints are written from a `number`, truncated to an integer (exact up to 2^53), or from a `bigint` (64 bits,
 *   for the larger `int64`/`uint64` values such as nanoseconds); the negative values take ten bytes, their 64-bit
 *   two's complement.
 * - A `string` field is written from `String(value)`; a `bytes` field from a `Uint8Array`, or a string as UTF-8.
 * - An empty repeated field or map is not written.
 * @param schema The message's definition.
 * @param message The message to encode; an empty message by default.
 * @returns The encoded bytes (empty for a message with only default values).
 * @example
 * ```typescript
 * import {Decode, Encode, type Message, type Schema} from '@lakutata/grpc'
 *
 * //message Point { int32 x = 1; int32 y = 2; }
 * const Point: Schema = {x: {no: 1, type: 'int32'}, y: {no: 2, type: 'int32'}}
 * //message Route { string name = 1; repeated Point points = 2; map<string, string> labels = 3; uint64 started = 4; }
 * const Route: Schema = {
 *     name: {no: 1, type: 'string'},
 *     points: {no: 2, type: Point, repeated: true},
 *     labels: {no: 3, type: 'string', map: true},
 *     started: {no: 4, type: 'uint64'}
 * }
 *
 * const bytes: Uint8Array = Encode(Route, {
 *     name: 'home',
 *     points: [{x: 1, y: 2}, {x: -3, y: 0}],
 *     labels: {zone: 'eu'},
 *     //Nanoseconds: a bigint keeps the 64 bits
 *     started: 1700000000000000000n
 * })
 * const route: Message = Decode(Route, bytes)
 * console.log(route.points) //[{x: 1, y: 2}, {x: -3}]: y = 0 is a default value, not written
 * ```
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
        const bits: bigint = ReadVarintBits(buffer, position)
        if (field.type === 'bool') return bits !== 0n
        //The 64-bit integers: signed or unsigned, numbers while they are safe integers, bigints beyond
        if (field.type === 'uint64') return Integer64(bits)
        if (field.type === 'int64') return Integer64(BigInt.asIntN(64, bits))
        const value: number = Number(BigInt.asIntN(64, bits))
        if (field.type === 'uint32') return value >>> 0
        if (field.type === 'int32') return value | 0
        return value
    }
    if (wire === WireType.LENGTH) {
        //A varint field given as bytes (the packed repeated fields are read before)
        if (typeof field.type === 'string' && VARINTS.has(field.type)) throw new Error(`The protobuf field ${field.no} has the wire type ${wire}, which the schema does not expect`)
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
 * The default value of a field, not written when it has it
 * @param field
 */
function DefaultValue(field: Field): unknown {
    if (typeof field.type === 'object') return {}
    if (field.type === 'string') return ''
    if (field.type === 'bool') return false
    if (field.type === 'bytes') return Buffer.alloc(0)
    return 0
}

/**
 * Decode protobuf bytes into a message.
 *
 * - The fields the schema does not declare are skipped (any wire type but the groups).
 * - A singular field missing from the bytes is absent from the message: proto3 does not write the default values, so
 *   read a missing field as its default (`message.count ?? 0`). A field present several times keeps its last value.
 * - The repeated fields are arrays, empty when the bytes have no item; the maps are objects, `{}` without entries. A map
 *   entry without its value gets the default of its type: `''`, `false`, an empty `Buffer`, `{}` for a message, `0`.
 * - `int64` (signed) and `uint64` (unsigned) are decoded as a `number` while they are safe integers (up to 2^53), as a
 *   `bigint` beyond, their 64 bits kept. `int32` and `uint32` are kept within 32 bits, `bool` is a boolean, `enum` its
 *   number.
 * - A `string` is decoded as UTF-8, `bytes` as a `Buffer` (a copy), a message field with its schema.
 * @param schema The message's definition.
 * @param buffer The encoded bytes; empty bytes decode as a message with no field set.
 * @returns The decoded message.
 * @throws {Error} When the bytes are truncated, a varint is longer than 64 bits, a declared field comes with a wire
 * type its schema type cannot have, or a wire type is unknown (the deprecated groups included).
 * @example
 * ```typescript
 * import {Decode, Encode, type Message, type Schema} from '@lakutata/grpc'
 *
 * //message Image { string name = 1; int64 size = 2; repeated string tags = 3; }
 * const Image: Schema = {name: {no: 1, type: 'string'}, size: {no: 2, type: 'int64'}, tags: {no: 3, type: 'string', repeated: true}}
 *
 * const image: Message = Decode(Image, Encode(Image, {name: 'alpine'}))
 * console.log(image.name) //alpine
 * console.log(image.size ?? 0) //0: a default value is not written, so it is absent
 * console.log(image.tags) //[]
 * ```
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
            //A value equal to its default is not written: the default of its type
            message[name][entry.key ?? ''] = entry.value ?? DefaultValue(field)
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
