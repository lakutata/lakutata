import {ILib} from './interfaces/ILib.js'
import koffi from 'koffi'
import {LibFunction} from './types/LibFunction.js'
import {TypeSpec} from './types/TypeSpec.js'

export class Library {

    #lib: ILib

    constructor(lib: string) {
        this.#lib = koffi.load(lib)
    }

    /**
     * Unload library
     */
    public destroy() {
        this.#lib.unload()
    }

    /**
     * Declare function in the library
     * @param definition
     */
    public func(definition: string): LibFunction
    /**
     * Declare function in the library
     * @param name
     * @param result
     * @param args
     */
    public func(name: string, result: TypeSpec, args: TypeSpec[]): LibFunction
    public func(nameOrDefinition: string, result?: TypeSpec, args?: TypeSpec[]): LibFunction {
        if (result && args) {
            return this.cdeclFunc(nameOrDefinition, result, args)
        } else {
            return this.cdeclFunc(nameOrDefinition)
        }
    }

    /**
     * Cdecl
     * This is the default convention, and the only one on other platforms
     * @param definition
     */
    public cdeclFunc(definition: string): LibFunction
    /**
     * Cdecl
     * This is the default convention, and the only one on other platforms
     * @param name
     * @param result
     * @param args
     */
    public cdeclFunc(name: string, result: TypeSpec, args: TypeSpec[]): LibFunction
    public cdeclFunc(nameOrDefinition: string, result?: TypeSpec, args?: TypeSpec[]): LibFunction {
        if (result && args) {
            return this.#lib.func(nameOrDefinition, result, args)
        } else {
            return this.#lib.func(nameOrDefinition)
        }
    }

    /**
     * Stdcall
     * This convention is used extensively within the Win32 API
     * @param name
     * @param result
     * @param args
     */
    public sdtcallFunc(name: string, result: TypeSpec, args: TypeSpec[]): LibFunction {
        return this.#lib.func('__stdcall', name, result, args)
    }

    /**
     * Fastcall
     * Rarely used, uses ECX and EDX for first two parameters
     * @param name
     * @param result
     * @param args
     */
    public fastcallFunc(name: string, result: TypeSpec, args: TypeSpec[]): LibFunction {
        return this.#lib.func('__fastcall', name, result, args)
    }

    /**
     * Thiscall
     * Rarely used, uses ECX for first parameter
     * @param name
     * @param result
     * @param args
     */
    public thiscallFunc(name: string, result: TypeSpec, args: TypeSpec[]): LibFunction {
        return this.#lib.func('__thiscall', name, result, args)
    }
}
