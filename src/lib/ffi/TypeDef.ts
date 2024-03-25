import koffi from 'koffi'
import {ICType} from './interfaces/ICType.js'
import {TypeSpecWithAlignment} from './types/TypeSpecWithAlignment.js'
import {TypeSpec} from './types/TypeSpec.js'
import {ArrayHint} from './types/ArrayHint.js'
import {As} from '../functions/As.js'

export class TypeDef {

    /**
     * Standard types
     * @see https://koffi.dev/input#standard-types
     */
    public static void: TypeSpec = 'void'
    public static int8: TypeSpec = 'int8'
    public static int8_t: TypeSpec = 'int8_t'
    public static uint8: TypeSpec = 'uint8'
    public static uint8_t: TypeSpec = 'uint8_t'
    public static char: TypeSpec = 'char'
    public static uchar: TypeSpec = 'uchar'
    public static unsigned_char: TypeSpec = 'unsigned char'
    public static char16: TypeSpec = 'char16'
    public static char16_t: TypeSpec = 'char16_t'
    public static int16: TypeSpec = 'int16'
    public static int16_t: TypeSpec = 'int16_t'
    public static uint16: TypeSpec = 'uint16'
    public static uint16_t: TypeSpec = 'uint16_t'
    public static short: TypeSpec = 'short'
    public static ushort: TypeSpec = 'ushort'
    public static unsigned_short: TypeSpec = 'unsigned short'
    public static int32: TypeSpec = 'int32'
    public static int32_t: TypeSpec = 'int32_t'
    public static uint32: TypeSpec = 'uint32'
    public static uint32_t: TypeSpec = 'uint32_t'
    public static int: TypeSpec = 'int'
    public static uint: TypeSpec = 'uint'
    public static unsigned_int: TypeSpec = 'unsigned int'
    public static int64: TypeSpec = 'int64'
    public static int64_t: TypeSpec = 'int64_t'
    public static uint64: TypeSpec = 'uint64'
    public static uint64_t: TypeSpec = 'uint64_t'
    public static longlong: TypeSpec = 'longlong'
    public static long_long: TypeSpec = 'long long'
    public static ulonglong: TypeSpec = 'ulonglong'
    public static unsigned_long_long: TypeSpec = 'unsigned long long'
    public static float32: TypeSpec = 'float32'
    public static float64: TypeSpec = 'float64'
    public static float: TypeSpec = 'float'
    public static double: TypeSpec = 'double'
    /**
     * Size changeable types
     * @see https://koffi.dev/input#standard-types
     */
    public static bool: TypeSpec = 'bool'
    public static long: TypeSpec = 'long'
    public static ulong: TypeSpec = 'ulong'
    public static unsigned_long: TypeSpec = 'unsigned long'
    public static intptr: TypeSpec = 'intptr'
    public static intptr_t: TypeSpec = 'intptr_t'
    public static uintptr: TypeSpec = 'uintptr'
    public static uintptr_t: TypeSpec = 'uintptr_t'
    public static str: TypeSpec = 'str'
    public static string: TypeSpec = 'string'
    public static str16: TypeSpec = 'str16'
    public static string16: TypeSpec = 'string16'
    /**
     * Endian-sensitive integers
     * @see https://koffi.dev/input#endian-sensitive-integers
     */
    public static int16_le: TypeSpec = 'int16_le'
    public static int16_le_t: TypeSpec = 'int16_le_t'
    public static int16_be: TypeSpec = 'int16_be'
    public static int16_be_t: TypeSpec = 'int16_be_t'
    public static uint16_le: TypeSpec = 'uint16_le'
    public static uint16_le_t: TypeSpec = 'uint16_le_t'
    public static uint16_be: TypeSpec = 'uint16_be'
    public static uint16_be_t: TypeSpec = 'uint16_be_t'
    public static int32_le: TypeSpec = 'int32_le'
    public static int32_le_t: TypeSpec = 'int32_le_t'
    public static int32_be: TypeSpec = 'int32_be'
    public static int32_be_t: TypeSpec = 'int32_be_t'
    public static uint32_le: TypeSpec = 'uint32_le'
    public static uint32_le_t: TypeSpec = 'uint32_le_t'
    public static uint32_be: TypeSpec = 'uint32_be'
    public static uint32_be_t: TypeSpec = 'uint32_be_t'
    public static int64_le: TypeSpec = 'int64_le'
    public static int64_le_t: TypeSpec = 'int64_le_t'
    public static int64_be: TypeSpec = 'int64_be'
    public static int64_be_t: TypeSpec = 'int64_be_t'
    public static uint64_le: TypeSpec = 'uint64_le'
    public static uint64_le_t: TypeSpec = 'uint64_le_t'
    public static uint64_be: TypeSpec = 'uint64_be'
    public static uint64_be_t: TypeSpec = 'uint64_be_t'

    /**
     * typedef union
     * @see https://koffi.dev/unions#union-values
     * @param name
     * @param def
     */
    public static union(name: string, def: Record<string, TypeSpecWithAlignment>): ICType {
        return koffi.union(name, def)
    }

    /**
     * typedef struct
     * @see https://koffi.dev/input#struct-types
     * @param name
     * @param def
     */
    public static struct(name: string, def: Record<string, TypeSpecWithAlignment>): ICType {
        return koffi.struct(name, def)
    }

    /**
     * typedef array
     * @see https://koffi.dev/input#array-types
     * @param ref
     * @param len
     * @param hint
     */
    public static array(ref: TypeSpec, len: number, hint?: ArrayHint | null): ICType {
        return koffi.array(ref, len, hint)
    }

    /**
     * pointer type
     * @see https://koffi.dev/pointers#data-pointers
     * @param ref
     */
    public static pointer(ref: TypeSpec): ICType
    /**
     * pointer type
     * @see https://koffi.dev/pointers#data-pointers
     * @param name
     * @param ref
     */
    public static pointer(name: string, ref: TypeSpec): ICType
    public static pointer(nameOrRef: string, ref?: TypeSpec): ICType {
        return ref ? koffi.pointer(nameOrRef, ref) : koffi.pointer(nameOrRef)
    }

    /**
     * opaque type
     * @see https://koffi.dev/input#opaque-types
     */
    public static opaque(): ICType
    /**
     * opaque type
     * @see https://koffi.dev/input#opaque-types
     * @param name
     */
    public static opaque(name: string): ICType
    public static opaque(name?: string): ICType {
        return name ? koffi.opaque(name) : koffi.opaque()
    }

    /**
     * disposable type
     * @see https://koffi.dev/pointers#disposable-types
     * @param name
     */
    public static disposable(name: string): ICType
    /**
     * disposable type
     * @see https://koffi.dev/pointers#disposable-types
     * @param name
     * @param type
     */
    public static disposable(name: string, type: TypeSpec): ICType
    /**
     * disposable type
     * @see https://koffi.dev/pointers#disposable-types
     * @param name
     * @param type
     * @param freeFunction
     */
    public static disposable(name: string, type: TypeSpec, freeFunction: Function): ICType
    public static disposable(name: string, type?: TypeSpec, freeFunction?: Function): ICType {
        return type !== undefined
            ? freeFunction !== undefined
                ? koffi.disposable(name, type, freeFunction)
                : koffi.disposable(name, type)
            : koffi.disposable(name)
    }

    /**
     * callback type
     * @see https://koffi.dev/callbacks#callback-types
     * @param definition
     */
    public static proto(definition: string): ICType
    /**
     * callback type
     * @see https://koffi.dev/callbacks#callback-types
     * @param name
     * @param result
     * @param args
     */
    public static proto(name: string, result: TypeSpec, args: TypeSpec[]): ICType
    /**
     * callback type
     * @see https://koffi.dev/callbacks#callback-types
     * @param convention
     * @param name
     * @param result
     * @param args
     */
    public static proto(convention: string, name: string, result: TypeSpec, args: TypeSpec[]): ICType
    public static proto(conventionOrDefinition: string, nameOrResult?: string | TypeSpec, resultOrArgs?: TypeSpec | TypeSpec[], args?: TypeSpec[]): ICType {
        switch (arguments.length) {
            case 3:
                return koffi.proto(conventionOrDefinition, As<TypeSpec>(nameOrResult), As<TypeSpec[]>(resultOrArgs))
            case 4:
                return koffi.proto(conventionOrDefinition, As<string>(nameOrResult), As<TypeSpec>(resultOrArgs), As<TypeSpec[]>(args))
            default:
                return koffi.proto(conventionOrDefinition)
        }
    }
}
