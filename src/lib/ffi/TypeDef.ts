import koffi from 'koffi'
import {ICType} from './interfaces/ICType.js'
import {TypeSpecWithAlignment} from './types/TypeSpecWithAlignment.js'
import {TypeSpec} from './types/TypeSpec.js'
import {ArrayHint} from './types/ArrayHint.js'

export class TypeDef {

    /**
     * typedef union
     * @param name
     * @param def
     */
    public static union(name: string, def: Record<string, TypeSpecWithAlignment>): ICType {
        return koffi.union(name, def)
    }

    /**
     * typedef struct
     * @param name
     * @param def
     */
    public static struct(name: string, def: Record<string, TypeSpecWithAlignment>): ICType {
        return koffi.struct(name, def)
    }

    /**
     * typedef array
     * @param ref
     * @param len
     * @param hint
     */
    public static array(ref: TypeSpec, len: number, hint?: ArrayHint | null): ICType {
        return koffi.array(ref, len, hint)
    }
}
