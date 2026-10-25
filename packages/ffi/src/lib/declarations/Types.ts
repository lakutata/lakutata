import type {Platform} from './Platform.js'

/**
 * The arithmetic types of C, by their meaning (long is not int64: their sizes differ between the platforms)
 */
export type PrimitiveName =
    | 'void' | 'bool'
    | 'char' | 'schar' | 'uchar' | 'short' | 'ushort' | 'int' | 'uint' | 'long' | 'ulong' | 'longlong' | 'ulonglong'
    | 'int8' | 'uint8' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'int64' | 'uint64'
    | 'size' | 'ssize' | 'intptr' | 'uintptr' | 'ptrdiff'
    | 'char16' | 'char32' | 'wchar'
    | 'float' | 'double'

/**
 * How the arguments of a function are passed: different on 32-bit Windows only
 */
export type CallingConvention = 'cdecl' | 'stdcall' | 'fastcall' | 'thiscall'

/**
 * Which way a pointer argument carries its value: into the function, out of it (the object or the array given is
 * filled once it returns), or both
 */
export type Direction = 'in' | 'out' | 'inout'

export interface PrimitiveType {
    readonly kind: 'primitive'
    readonly name: PrimitiveName
}

export interface PointerType {
    readonly kind: 'pointer'
    readonly to: CType
    /**
     * Whether what it points to is const (const char * is a string given to the function)
     */
    readonly constTarget: boolean
}

export interface ArrayType {
    readonly kind: 'array'
    readonly of: CType
    readonly length: number
}

export interface Member {
    /**
     * Its name; the anonymous structs and unions inside a struct are named _0, _1… in the order of the struct
     */
    readonly name: string
    readonly type: CType
    /**
     * The width of a bitfield
     */
    readonly bits?: number
    /**
     * The alignment its aligned attribute asks for, in bytes
     */
    readonly align?: number
}

/**
 * A struct or a union. One without members is opaque (declared, not defined); it is completed in place when defined
 */
export interface RecordType {
    readonly kind: 'struct' | 'union'
    readonly tag?: string
    members?: Member[]
    /**
     * The alignment its members are capped at (#pragma pack, the packed attribute)
     */
    pack?: number
    /**
     * The alignment its aligned attribute asks for, in bytes
     */
    align?: number
}

export interface EnumType {
    readonly kind: 'enum'
    readonly tag?: string
    /**
     * The integer type holding its values
     */
    readonly base: PrimitiveName
    readonly values: ReadonlyMap<string, bigint>
}

export interface Parameter {
    readonly name?: string
    readonly type: CType
    readonly direction: Direction
}

export interface FunctionType {
    readonly kind: 'function'
    readonly result: CType
    readonly parameters: readonly Parameter[]
    readonly variadic: boolean
    readonly convention: CallingConvention
}

/**
 * A C type, as the declarations describe it
 */
export type CType = PrimitiveType | PointerType | ArrayType | RecordType | EnumType | FunctionType

/**
 * A function the library exports
 */
export interface FunctionDeclaration {
    readonly name: string
    /**
     * The name of its symbol in the library: its name, or the one of its __asm label
     */
    readonly symbol: string
    readonly type: FunctionType
}

/**
 * A variable the library exports
 */
export interface VariableDeclaration {
    readonly name: string
    readonly symbol: string
    readonly type: CType
    readonly constant: boolean
}

/**
 * What a text of declarations declares
 */
export interface Declarations {
    /**
     * The typedefs
     */
    readonly types: Map<string, CType>
    /**
     * The tags of the structs, unions and enums ("struct timeval")
     */
    readonly tags: Map<string, RecordType | EnumType>
    readonly functions: Map<string, FunctionDeclaration>
    readonly variables: Map<string, VariableDeclaration>
    /**
     * The values of the enumerations, of the static constants and of the macros whose value is an integer
     */
    readonly constants: Map<string, bigint>
    /**
     * The macros without arguments (#define): their tokens, empty for the ones that are removed where used (the
     * markers of exported functions); null for the macros with arguments, which cannot be used
     */
    readonly macros: Map<string, MacroToken[] | null>
}

/**
 * A token of a macro: its kind and its text (and its value, for a number or a character)
 */
export interface MacroToken {
    readonly kind: 'identifier' | 'number' | 'char' | 'string' | 'punctuator'
    readonly text: string
    readonly value?: bigint
    readonly float?: boolean
}

/**
 * An empty set of declarations
 */
export function emptyDeclarations(): Declarations {
    return {types: new Map(), tags: new Map(), functions: new Map(), variables: new Map(), constants: new Map(), macros: new Map()}
}

export const VOID: PrimitiveType = {kind: 'primitive', name: 'void'}

/**
 * The size of an arithmetic type, in bytes
 * @param name
 * @param platform
 */
export function primitiveSize(name: PrimitiveName, platform: Platform): number {
    switch (name) {
        case 'void':
            return 0
        case 'bool':
        case 'char':
        case 'schar':
        case 'uchar':
        case 'int8':
        case 'uint8':
            return 1
        case 'short':
        case 'ushort':
        case 'int16':
        case 'uint16':
        case 'char16':
            return 2
        case 'int':
        case 'uint':
        case 'int32':
        case 'uint32':
        case 'char32':
        case 'float':
            return 4
        case 'long':
        case 'ulong':
            return platform.longSize
        case 'longlong':
        case 'ulonglong':
        case 'int64':
        case 'uint64':
        case 'double':
            return 8
        case 'size':
        case 'ssize':
        case 'intptr':
        case 'uintptr':
        case 'ptrdiff':
            return platform.pointerSize
        case 'wchar':
            return platform.wcharSize
    }
}

/**
 * Whether an arithmetic type is signed
 * @param name
 * @param platform
 */
export function primitiveSigned(name: PrimitiveName, platform: Platform): boolean {
    switch (name) {
        case 'char':
            //char is signed but on the ARM systems other than Apple's and Microsoft's (koffi reads it as signed everywhere)
            return true
        case 'schar':
        case 'short':
        case 'int':
        case 'long':
        case 'longlong':
        case 'int8':
        case 'int16':
        case 'int32':
        case 'int64':
        case 'ssize':
        case 'intptr':
        case 'ptrdiff':
        case 'float':
        case 'double':
            return true
        case 'wchar':
            return platform.os !== 'win32'
        default:
            return false
    }
}

/**
 * Whether an arithmetic type is an integer
 * @param name
 */
export function primitiveInteger(name: PrimitiveName): boolean {
    return name !== 'void' && name !== 'float' && name !== 'double'
}

/**
 * Whether an integer type is 64-bit on one of the platforms at least: its values are bigints (long is 64-bit but on
 * Windows, size_t but on 32-bit systems)
 * @param name
 */
export function primitiveBig(name: PrimitiveName): boolean {
    switch (name) {
        case 'long':
        case 'ulong':
        case 'longlong':
        case 'ulonglong':
        case 'int64':
        case 'uint64':
        case 'size':
        case 'ssize':
        case 'intptr':
        case 'uintptr':
        case 'ptrdiff':
            return true
        default:
            return false
    }
}

/**
 * A type, as C writes it (for the messages)
 * @param type
 */
export function typeText(type: CType): string {
    switch (type.kind) {
        case 'primitive':
            return PRIMITIVE_TEXT[type.name]
        case 'pointer':
            return `${type.constTarget ? 'const ' : ''}${typeText(type.to)} *`
        case 'array':
            return `${typeText(type.of)}[${type.length}]`
        case 'struct':
        case 'union':
            return `${type.kind} ${type.tag ?? '(anonymous)'}`
        case 'enum':
            return `enum ${type.tag ?? '(anonymous)'}`
        case 'function':
            return `${typeText(type.result)} (${type.parameters.map((parameter: Parameter): string => typeText(parameter.type)).concat(type.variadic ? ['...'] : []).join(', ')})`
    }
}

const PRIMITIVE_TEXT: Record<PrimitiveName, string> = {
    void: 'void',
    bool: 'bool',
    char: 'char',
    schar: 'signed char',
    uchar: 'unsigned char',
    short: 'short',
    ushort: 'unsigned short',
    int: 'int',
    uint: 'unsigned int',
    long: 'long',
    ulong: 'unsigned long',
    longlong: 'long long',
    ulonglong: 'unsigned long long',
    int8: 'int8_t',
    uint8: 'uint8_t',
    int16: 'int16_t',
    uint16: 'uint16_t',
    int32: 'int32_t',
    uint32: 'uint32_t',
    int64: 'int64_t',
    uint64: 'uint64_t',
    size: 'size_t',
    ssize: 'ssize_t',
    intptr: 'intptr_t',
    uintptr: 'uintptr_t',
    ptrdiff: 'ptrdiff_t',
    char16: 'char16_t',
    char32: 'char32_t',
    wchar: 'wchar_t',
    float: 'float',
    double: 'double'
}
