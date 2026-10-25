import koffi, {type TypeObject} from 'koffi'
import {NativeDeclarationException} from '../../exceptions/NativeDeclarationException.js'
import {alignmentOf, layoutOf, type MemberLayout, type RecordLayout} from '../declarations/Layout.js'
import type {Platform} from '../declarations/Platform.js'
import {type CType, type FunctionType, type Member, type PrimitiveName, primitiveBig, primitiveSigned, type RecordType, typeText} from '../declarations/Types.js'

/**
 * A type as koffi takes it: its name, its object, or its object with a direction (an output parameter)
 */
export type KoffiType = string | TypeObject | ReturnType<typeof koffi.out>

/**
 * How a value goes between the user and koffi, when koffi does not give or take it as the package does: the 64-bit
 * integers always bigints, the bitfields of a struct read and written by their names
 */
export interface Converter {
    /**
     * A value of the user to the value koffi takes
     */
    readonly toNative?: (value: any) => any
    /**
     * A value koffi gives to the value of the user
     */
    readonly fromNative?: (value: any) => any
}

/**
 * The names koffi gives the arithmetic types (ssize_t and ptrdiff_t have the size and the sign of intptr_t)
 */
const KOFFI_NAMES: Record<PrimitiveName, string> = {
    void: 'void',
    bool: 'bool',
    char: 'char',
    schar: 'int8_t',
    uchar: 'uchar',
    short: 'short',
    ushort: 'ushort',
    int: 'int',
    uint: 'uint',
    long: 'long',
    ulong: 'ulong',
    longlong: 'longlong',
    ulonglong: 'ulonglong',
    int8: 'int8_t',
    uint8: 'uint8_t',
    int16: 'int16_t',
    uint16: 'uint16_t',
    int32: 'int32_t',
    uint32: 'uint32_t',
    int64: 'int64_t',
    uint64: 'uint64_t',
    size: 'size_t',
    ssize: 'intptr_t',
    intptr: 'intptr_t',
    uintptr: 'uintptr_t',
    ptrdiff: 'intptr_t',
    char16: 'char16_t',
    char32: 'char32_t',
    wchar: 'wchar_t',
    float: 'float',
    double: 'double'
}

/**
 * The prefix of the members the package adds to the structs it lays out itself (the bytes of the bitfields, padding):
 * the names starting with two underscores are reserved to the compilers and the C library, never a struct of a user
 */
const INTERNAL: string = '__lakutata_'

/**
 * A value of a 64-bit integer type, as a bigint
 * @param value
 */
export function toBigInt(value: unknown): unknown {
    return typeof value === 'number' ? BigInt(value) : value
}

/**
 * The integer type of a primitive or of an enumeration
 * @param type
 */
function integerName(type: CType): PrimitiveName | undefined {
    if (type.kind === 'primitive') return type.name
    if (type.kind === 'enum') return type.base
    return undefined
}

/**
 * Round up to a multiple
 * @param value
 * @param multiple
 */
function alignUp(value: number, multiple: number): number {
    return Math.ceil(value / multiple) * multiple
}

/**
 * The koffi types of the C types of the declarations, made once each (koffi never frees a type): anonymous, so the
 * types of two libraries never meet; the structs koffi cannot lay out (bitfields, packing) laid out by the package
 */
export class KoffiTypes {

    readonly #platform: Platform

    readonly #types: WeakMap<CType, TypeObject> = new WeakMap()

    readonly #converters: WeakMap<CType, Converter | null> = new WeakMap()

    readonly #prototypes: WeakMap<FunctionType, TypeObject> = new WeakMap()

    /**
     * The koffi types of a platform.
     * @param platform The platform of the process.
     */
    constructor(platform: Platform) {
        this.#platform = platform
    }

    /**
     * The koffi type of a C type, as a value: a member, a result, a parameter without direction.
     * @param type The C type.
     */
    public type(type: CType): KoffiType {
        switch (type.kind) {
            case 'primitive':
                return KOFFI_NAMES[type.name]
            case 'enum':
                return KOFFI_NAMES[type.base]
            case 'pointer':
                return this.#pointer(type.to)
            case 'array':
                return this.#cached(type, (): TypeObject => koffi.array(this.type(type.of), type.length))
            case 'struct':
            case 'union':
                if (type.tag === 'va_list' && !type.members) throw new NativeDeclarationException('A va_list cannot be passed: call the function of the library that takes the arguments themselves')
                return this.#record(type)
            case 'function':
                throw new NativeDeclarationException(`A function is not a value: use a pointer to it (${typeText(type)})`)
        }
    }

    /**
     * The koffi prototype of a function type: the type of its callbacks.
     * @param type The function type.
     */
    public prototype(type: FunctionType): TypeObject {
        const known: TypeObject | undefined = this.#prototypes.get(type)
        if (known) return known
        if (type.variadic) throw new NativeDeclarationException(`A callback cannot be variadic: ${typeText(type)}`)
        const prototype: TypeObject = koffi.proto(`__${type.convention}`, this.type(type.result), type.parameters.map((parameter): KoffiType => this.type(parameter.type)))
        this.#prototypes.set(type, prototype)
        return prototype
    }

    /**
     * The converter of a C type, null when koffi gives and takes its values as the package does.
     * @param type The C type.
     */
    public converter(type: CType): Converter | null {
        const known: Converter | null | undefined = this.#converters.get(type)
        if (known !== undefined) return known
        let converter: Converter | null = null
        switch (type.kind) {
            case 'primitive':
            case 'enum':
                if (primitiveBig(integerName(type)!)) converter = {fromNative: toBigInt}
                break
            case 'array': {
                const element: Converter | null = this.converter(type.of)
                if (element) {
                    converter = {
                        ...element.toNative ? {toNative: (value: any): any => Array.isArray(value) ? value.map(element.toNative!) : value} : {},
                        ...element.fromNative ? {fromNative: (value: any): any => value && typeof value !== 'string' ? Array.from(value as ArrayLike<unknown>, element.fromNative!) : value} : {}
                    }
                }
                break
            }
            case 'struct':
            case 'union':
                if (type.members) {
                    //Reserved first: a struct reached through its own members converts as it is being made
                    this.#converters.set(type, null)
                    converter = this.#recordConverter(type)
                }
                break
        }
        this.#converters.set(type, converter)
        return converter
    }

    /**
     * The koffi type of a pointer: the strings for char (and char16_t, wchar_t), the prototypes for functions
     * @param to
     */
    #pointer(to: CType): KoffiType {
        if (to.kind === 'primitive') {
            if (to.name === 'char') return 'char *'
            if (to.name === 'char16') return 'char16_t *'
            if (to.name === 'wchar') return 'wchar_t *'
            if (to.name === 'void') return 'void *'
        }
        if (to.kind === 'function') return this.#cached(to, (): TypeObject => koffi.pointer(this.prototype(to)))
        if ((to.kind === 'struct' || to.kind === 'union') && !to.members) return this.#cached(to, (): TypeObject => koffi.pointer(koffi.opaque()))
        return koffi.pointer(this.type(to))
    }

    /**
     * A type made once for a C type
     * @param type
     * @param make
     */
    #cached(type: CType, make: () => TypeObject): TypeObject {
        let made: TypeObject | undefined = this.#types.get(type)
        if (!made) {
            made = make()
            this.#types.set(type, made)
        }
        return made
    }

    /**
     * The koffi type of a struct or a union, declared first as an opaque type its own members can point to
     * @param record
     */
    #record(record: RecordType): TypeObject {
        const known: TypeObject | undefined = this.#types.get(record)
        if (known) return known
        const layout: RecordLayout = layoutOf(record, this.#platform)
        const placeholder: TypeObject = koffi.opaque()
        this.#types.set(record, placeholder)
        const members: Record<string, KoffiType | [number, KoffiType]> = this.#members(record, layout)
        const made: TypeObject = record.kind === 'union' ? koffi.union(placeholder, members as any) : koffi.struct(placeholder, members as any)
        this.#types.set(record, made)
        //What koffi lays out must be what the platform lays out: the size, the alignment, the offset of each member
        const misplaced: MemberLayout | undefined = record.kind === 'struct' ? layout.members.find((placed: MemberLayout): boolean => placed.bits === undefined && !!made.members?.[placed.member.name] && made.members[placed.member.name].offset !== placed.offset) : undefined
        if (made.size !== layout.size || made.alignment !== layout.alignment || misplaced) {
            throw new NativeDeclarationException(`The layout of ${typeText(record)} could not be given to koffi (${made.size} bytes aligned on ${made.alignment}, ${layout.size} on ${layout.alignment} expected${misplaced ? `, ${misplaced.member.name} at ${made.members![misplaced.member.name].offset}, ${misplaced.offset} expected` : ''})`)
        }
        return made
    }

    /**
     * The members of a struct as koffi lays them out: each at the alignment the platform gives it (capped by the packing,
     * raised by an aligned attribute), the bytes of the bitfields and the padding they need as arrays of bytes, the
     * alignment of the struct on its first member when its members alone do not give it
     * @param record
     * @param layout
     */
    #members(record: RecordType, layout: RecordLayout): Record<string, KoffiType | [number, KoffiType]> {
        const entries: { name: string, type: KoffiType, offset: number, size: number, alignment: number }[] = []
        if (record.kind === 'union') {
            for (const placed of layout.members) entries.push({name: placed.member.name, type: this.type(placed.member.type), offset: 0, size: placed.size, alignment: this.#memberAlignment(placed.member, record)})
        } else {
            let chunk: number = 0
            for (const group of this.#groups(layout)) {
                if ('bitfields' in group) {
                    entries.push({name: `${INTERNAL}bits${chunk++}`, type: koffi.array('uint8_t', group.size, 'Typed'), offset: group.offset, size: group.size, alignment: 1})
                    continue
                }
                //A flexible array member has no bytes: koffi does not need it
                if (group.member.type.kind === 'array' && group.member.type.length === 0) continue
                entries.push({name: group.member.name, type: this.type(group.member.type), offset: group.offset, size: group.size, alignment: this.#memberAlignment(group.member, record)})
            }
        }
        const members: Record<string, KoffiType | [number, KoffiType]> = {}
        let end: number = 0
        let alignment: number = 1
        let padding: number = 0
        entries.forEach((entry, index: number): void => {
            if (record.kind === 'struct' && alignUp(end, entry.alignment) !== entry.offset) {
                members[`${INTERNAL}pad${padding++}`] = [1, koffi.array('uint8_t', entry.offset - end, 'Typed')]
                end = entry.offset
            }
            //The alignment of the struct, on its first member (at 0, aligned on anything)
            const own: number = index === 0 && layout.alignment > entry.alignment && this.#alignmentShortfall(entries, layout) ? layout.alignment : entry.alignment
            members[entry.name] = own === this.#naturalAlignment(entry.type) ? entry.type : [own, entry.type]
            alignment = Math.max(alignment, own)
            end = record.kind === 'struct' ? entry.offset + entry.size : Math.max(end, entry.size)
        })
        if (!entries.length) members[`${INTERNAL}pad${padding++}`] = [layout.alignment, koffi.array('uint8_t', layout.size || 1, 'Typed')]
        else if (record.kind === 'struct' && alignUp(end, Math.max(alignment, layout.alignment)) < layout.size) members[`${INTERNAL}pad${padding++}`] = [1, koffi.array('uint8_t', layout.size - end, 'Typed')]
        return members
    }

    /**
     * Whether the members of a struct alone are aligned less than the struct (an aligned attribute on the struct, the
     * type of a bitfield, a flexible array member)
     * @param entries
     * @param layout
     */
    #alignmentShortfall(entries: { alignment: number }[], layout: RecordLayout): boolean {
        return Math.max(1, ...entries.map((entry): number => entry.alignment)) < layout.alignment
    }

    /**
     * The alignment koffi gives a type by itself
     * @param type
     */
    #naturalAlignment(type: KoffiType): number {
        return koffi.type(type as any).alignment
    }

    /**
     * The alignment of a member on the platform: its type's, raised by its aligned attribute, capped by the packing
     * @param member
     * @param record
     */
    #memberAlignment(member: Member, record: RecordType): number {
        const natural: number = Math.max(alignmentOf(member.type, this.#platform), member.align ?? 1)
        return record.pack ? Math.min(natural, record.pack) : natural
    }

    /**
     * The members of a struct in the order of their offsets, the bitfields sharing bytes grouped
     * @param layout
     */
    #groups(layout: RecordLayout): ({ member: Member, offset: number, size: number } | { bitfields: MemberLayout[], offset: number, size: number })[] {
        const groups: ({ member: Member, offset: number, size: number } | { bitfields: MemberLayout[], offset: number, size: number })[] = []
        for (const placed of layout.members) {
            if (placed.bits === undefined) {
                groups.push({member: placed.member, offset: placed.offset, size: placed.size})
                continue
            }
            const first: number = Math.floor(placed.bitOffset! / 8)
            const last: number = Math.ceil((placed.bitOffset! + placed.bits) / 8)
            const previous = groups[groups.length - 1]
            if (previous && 'bitfields' in previous && first <= previous.offset + previous.size) {
                previous.bitfields.push(placed)
                previous.size = Math.max(previous.size, last - previous.offset)
            } else {
                groups.push({bitfields: [placed], offset: first, size: last - first})
            }
        }
        return groups
    }

    /**
     * The converter of a struct or a union: the converters of its members; its bitfields read from and written to the
     * bytes holding them; the members the package added left out
     * @param record
     */
    #recordConverter(record: RecordType): Converter | null {
        const layout: RecordLayout = layoutOf(record, this.#platform)
        const groups = record.kind === 'struct' ? this.#groups(layout) : layout.members.map((placed): { member: Member, offset: number, size: number } => ({member: placed.member, offset: 0, size: placed.size}))
        const made: TypeObject = this.#record(record)
        const internal: boolean = Object.keys(made.members ?? {}).some((name: string): boolean => name.startsWith(INTERNAL))
        const members: { name: string, converter: Converter | null }[] = []
        const bitfields: { name: string, chunk: string, offset: number, bits: number, signed: boolean, big: boolean }[] = []
        let chunk: number = 0
        for (const group of groups) {
            if ('bitfields' in group) {
                const name: string = `${INTERNAL}bits${chunk++}`
                for (const placed of group.bitfields) {
                    if (!placed.member.name) continue
                    const integer: PrimitiveName = integerName(placed.member.type)!
                    bitfields.push({name: placed.member.name, chunk: name, offset: placed.bitOffset! - group.offset * 8, bits: placed.bits!, signed: primitiveSigned(integer, this.#platform), big: primitiveBig(integer)})
                }
                continue
            }
            if (group.member.type.kind === 'array' && group.member.type.length === 0) continue
            members.push({name: group.member.name, converter: this.converter(group.member.type)})
        }
        const converted = members.filter((member): boolean => !!member.converter)
        if (!converted.length && !bitfields.length && !internal) return null
        const chunks: Map<string, number> = new Map(groups.filter((group): boolean => 'bitfields' in group).map((group, index: number): [string, number] => [`${INTERNAL}bits${index}`, group.size]))
        const toNativeMembers = converted.filter((member): boolean => !!member.converter!.toNative)
        const writes: boolean = toNativeMembers.length > 0 || bitfields.length > 0
        return {
            ...writes ? {
                toNative: (value: any): any => {
                    if (!value || typeof value !== 'object' || ArrayBuffer.isView(value)) return value
                    const native: Record<string, unknown> = {...value}
                    for (const member of toNativeMembers) if (member.name in native) native[member.name] = member.converter!.toNative!(native[member.name])
                    if (bitfields.length) {
                        const bytes: Map<string, Uint8Array> = new Map([...chunks].map(([name, size]): [string, Uint8Array] => [name, new Uint8Array(size)]))
                        for (const field of bitfields) {
                            const given: unknown = native[field.name]
                            delete native[field.name]
                            if (given === undefined || given === null) continue
                            writeBits(bytes.get(field.chunk)!, field.offset, field.bits, BigInt(given as number | bigint))
                        }
                        for (const [name, array] of bytes) native[name] = array
                    }
                    return native
                }
            } : {},
            fromNative: (value: any): any => {
                if (!value || typeof value !== 'object') return value
                const result: Record<string, unknown> = {}
                for (const member of members) if (member.name in value) result[member.name] = member.converter?.fromNative ? member.converter.fromNative(value[member.name]) : value[member.name]
                for (const field of bitfields) {
                    const bits: bigint = readBits(value[field.chunk] as Uint8Array, field.offset, field.bits, field.signed)
                    result[field.name] = field.big ? bits : Number(bits)
                }
                return result
            }
        }
    }
}

/**
 * The bits of a bitfield, from its bytes (the lowest bits first)
 * @param bytes
 * @param offset its first bit in the bytes
 * @param bits its width
 * @param signed whether its type is signed (its highest bit extended)
 */
function readBits(bytes: Uint8Array, offset: number, bits: number, signed: boolean): bigint {
    let value: bigint = 0n
    for (let i: number = bits - 1; i >= 0; i--) {
        const bit: number = offset + i
        value = (value << 1n) | BigInt((bytes[bit >> 3] >> (bit & 7)) & 1)
    }
    return signed ? BigInt.asIntN(bits, value) : value
}

/**
 * The bits of a bitfield written to its bytes
 * @param bytes
 * @param offset
 * @param bits
 * @param value
 */
function writeBits(bytes: Uint8Array, offset: number, bits: number, value: bigint): void {
    const unsigned: bigint = BigInt.asUintN(bits, value)
    for (let i: number = 0; i < bits; i++) {
        const bit: number = offset + i
        if ((unsigned >> BigInt(i)) & 1n) bytes[bit >> 3] |= 1 << (bit & 7)
        else bytes[bit >> 3] &= ~(1 << (bit & 7))
    }
}
