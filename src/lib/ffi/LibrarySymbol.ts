import {TypeSpec} from './types/TypeSpec.js'
import {ILib} from './interfaces/ILib.js'
import koffi from 'koffi'
import {Library} from './Library.js'

export class LibrarySymbol {

    readonly #symbolName: string

    readonly #symbolType: TypeSpec

    readonly #library: Library

    readonly #ref: any

    constructor(library: Library, name: string, type: TypeSpec) {
        this.#symbolName = name
        this.#symbolType = type
        this.#library = library
        this.#ref = Reflect.getOwnMetadata(this.#library, this.#library).symbol(this.#symbolName, this.#symbolType)
    }

    /**
     * Get lib
     * @protected
     */
    #getLib(this: Library): ILib {
        return this.lib
    }

    /**
     * If library is unloaded, throw error
     * @param callback
     * @protected
     */
    protected process<T>(callback: () => T): T {
        this.#getLib.bind(this.#library)()
        return callback()
    }

    /**
     * Symbol value getter
     */
    public get value(): any {
        return this.process(() => koffi.decode(this.#ref, this.#symbolType))
    }

    /**
     * Symbol value setter
     * @param val
     */
    public set value(val: any) {
        this.process(() => koffi.encode(this.#ref, this.#symbolType, val))
    }

    /**
     * Set symbol value
     * @param value
     */
    public setValue(value: any): void
    /**
     * Set symbol value
     * @param value
     * @param len
     */
    public setValue(value: any, len: number): void
    /**
     * Set symbol value
     * @param value
     * @param len
     * @param offset
     */
    public setValue(value: any, len: number, offset: number): void
    public setValue(value: any, len?: number, offset?: number): void {
        return offset === undefined
            ? len === undefined
                ? this.process(() => koffi.encode(this.#ref, this.#symbolType, value))
                : this.process(() => koffi.encode(this.#ref, this.#symbolType, value, len))
            : this.process(() => koffi.encode(this.#ref, offset, this.#symbolType, value, len!))
    }

    /**
     * Get symbol value
     */
    public getValue(): any
    /**
     * Get symbol value
     * @param len
     */
    public getValue(len: number): any
    /**
     * Get symbol value
     * @param len
     * @param offset
     */
    public getValue(len: number, offset: number): any
    public getValue(len?: number, offset?: number): any {
        return offset === undefined
            ? len === undefined
                ? this.process(() => koffi.decode(this.#ref, this.#symbolType))
                : this.process(() => koffi.decode(this.#ref, this.#symbolType, len))
            : this.process(() => koffi.decode(this.#ref, offset, this.#symbolType, len!))
    }
}
