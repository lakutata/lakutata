import {NativeDeclarationException} from '../../exceptions/NativeDeclarationException.js'
import type {Platform} from './Platform.js'
import {type CType, type Member, primitiveSize, type RecordType, typeText} from './Types.js'

/**
 * Where a member of a struct is: its offset in bytes; for a bitfield, its first bit (from the start of the struct, the
 * lowest bits first) and its width
 */
export interface MemberLayout {
    readonly member: Member
    readonly offset: number
    readonly size: number
    readonly bitOffset?: number
    readonly bits?: number
}

export interface RecordLayout {
    readonly size: number
    readonly alignment: number
    readonly members: readonly MemberLayout[]
    /**
     * Whether it has bitfields (koffi does not lay them out: the package does)
     */
    readonly bitfields: boolean
}

const layouts: WeakMap<RecordType, Map<Platform, RecordLayout>> = new WeakMap()

/**
 * The size of a type, in bytes
 * @param type
 * @param platform
 */
export function sizeOf(type: CType, platform: Platform): number {
    switch (type.kind) {
        case 'primitive':
            return primitiveSize(type.name, platform)
        case 'pointer':
            return platform.pointerSize
        case 'array':
            return sizeOf(type.of, platform) * type.length
        case 'enum':
            return primitiveSize(type.base, platform)
        case 'struct':
        case 'union':
            return layoutOf(type, platform).size
        case 'function':
            throw new NativeDeclarationException(`A function has no size: ${typeText(type)}`)
    }
}

/**
 * The alignment of a type, in bytes
 * @param type
 * @param platform
 */
export function alignmentOf(type: CType, platform: Platform): number {
    switch (type.kind) {
        case 'primitive':
        case 'enum': {
            const size: number = primitiveSize(type.kind === 'primitive' ? type.name : type.base, platform)
            return size === 8 ? platform.int64Alignment : Math.max(size, 1)
        }
        case 'pointer':
            return platform.pointerSize
        case 'array':
            return alignmentOf(type.of, platform)
        case 'struct':
        case 'union':
            return layoutOf(type, platform).alignment
        case 'function':
            throw new NativeDeclarationException(`A function has no alignment: ${typeText(type)}`)
    }
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
 * The layout of a struct or of a union, as the compilers of the platform lay it out (GCC and Clang, or Microsoft's for
 * the bitfields): the alignment of each member capped by #pragma pack, raised by its aligned attribute
 * @param record
 * @param platform
 */
export function layoutOf(record: RecordType, platform: Platform): RecordLayout {
    let cached: Map<Platform, RecordLayout> | undefined = layouts.get(record)
    const found: RecordLayout | undefined = cached?.get(platform)
    if (found) return found
    if (!record.members) throw new NativeDeclarationException(`The ${record.kind} ${record.tag ?? '(anonymous)'} is declared but not defined: it is used through pointers only`)
    const layout: RecordLayout = record.kind === 'union' ? unionLayout(record, platform) : structLayout(record, platform)
    if (!cached) layouts.set(record, cached = new Map())
    cached.set(platform, layout)
    return layout
}

/**
 * The alignment of a member: its type's, raised by its aligned attribute, capped by the packing of its struct
 * @param member
 * @param record
 * @param platform
 */
function memberAlignment(member: Member, record: RecordType, platform: Platform): number {
    const natural: number = Math.max(alignmentOf(member.type, platform), member.align ?? 1)
    return record.pack ? Math.min(natural, record.pack) : natural
}

/**
 * The layout of a union: every member at 0
 * @param record
 * @param platform
 */
function unionLayout(record: RecordType, platform: Platform): RecordLayout {
    let size: number = 0
    let alignment: number = record.align ?? 1
    const members: MemberLayout[] = []
    for (const member of record.members!) {
        if (member.bits !== undefined) throw new NativeDeclarationException(`The bitfield ${member.name || '(unnamed)'} of a union is not supported`)
        const memberSize: number = sizeOf(member.type, platform)
        alignment = Math.max(alignment, memberAlignment(member, record, platform))
        size = Math.max(size, memberSize)
        members.push({member: member, offset: 0, size: memberSize})
    }
    return {size: alignUp(size, alignment), alignment: alignment, members: members, bitfields: false}
}

/**
 * The layout of a struct: the members one after the other, each at its alignment; the bitfields in the storage units of
 * their types, by the rules of the platform
 * @param record
 * @param platform
 */
function structLayout(record: RecordType, platform: Platform): RecordLayout {
    let bit: number = 0
    let alignment: number = record.align ?? 1
    let bitfields: boolean = false
    //The storage unit of the bitfields being filled (Microsoft's rules): its offset in bytes, its size, the bits used
    let unit: { offset: number, size: number, used: number } | undefined
    const members: MemberLayout[] = []
    for (const member of record.members!) {
        if (member.bits === undefined) {
            unit = undefined
            const aligned: number = memberAlignment(member, record, platform)
            const offset: number = alignUp(Math.ceil(bit / 8), aligned)
            const size: number = sizeOf(member.type, platform)
            members.push({member: member, offset: offset, size: size})
            bit = (offset + size) * 8
            alignment = Math.max(alignment, aligned)
            continue
        }
        bitfields = true
        if (record.pack !== undefined) throw new NativeDeclarationException(`The bitfield ${member.name || '(unnamed)'} of a packed struct is not supported`)
        if (member.type.kind !== 'primitive' && member.type.kind !== 'enum') throw new NativeDeclarationException(`The bitfield ${member.name || '(unnamed)'} must have an integer type`)
        const size: number = sizeOf(member.type, platform)
        const typeAlignment: number = alignmentOf(member.type, platform)
        const width: number = member.bits
        if (width > size * 8) throw new NativeDeclarationException(`The bitfield ${member.name || '(unnamed)'} is wider than its type (${width} bits)`)
        if (platform.bitfields === 'msvc') {
            if (width === 0) {
                //After a bitfield: ends its storage unit, the next member at the alignment of its type; ignored otherwise
                if (unit) {
                    bit = alignUp((unit.offset + unit.size) * 8, typeAlignment * 8)
                    alignment = Math.max(alignment, typeAlignment)
                }
                unit = undefined
                continue
            }
            if (!unit || unit.size !== size || unit.used + width > size * 8) {
                const start: number = unit ? unit.offset + unit.size : Math.ceil(bit / 8)
                unit = {offset: alignUp(start, typeAlignment), size: size, used: 0}
                alignment = Math.max(alignment, typeAlignment)
            }
            members.push({member: member, offset: unit.offset, size: size, bitOffset: unit.offset * 8 + unit.used, bits: width})
            unit.used += width
            bit = (unit.offset + unit.size) * 8
            continue
        }
        //GCC and Clang: in the first unit of the size of its type where it fits, from the current bit. The type of an
        //unnamed bitfield aligns the struct by the rules of ARM only
        if (member.name || platform.bitfields === 'aapcs') alignment = Math.max(alignment, typeAlignment)
        if (width === 0) {
            bit = alignUp(bit, typeAlignment * 8)
            continue
        }
        if ((bit % (size * 8)) + width > size * 8) bit = alignUp(bit, typeAlignment * 8)
        members.push({member: member, offset: Math.floor(bit / (size * 8)) * size, size: size, bitOffset: bit, bits: width})
        bit += width
    }
    if (unit) bit = (unit.offset + unit.size) * 8
    return {size: alignUp(Math.ceil(bit / 8), alignment), alignment: alignment, members: members, bitfields: bitfields}
}
