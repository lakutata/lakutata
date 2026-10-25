import {type CType, type FunctionType, type Member, type Parameter, type PrimitiveName, primitiveBig, type RecordType} from '../declarations/Types.js'

/**
 * Where a value is: given to a native function (a parameter, the result of a JS callback), or given by it (a result, a
 * member of a struct, an argument a JS callback receives)
 */
export type Flow = 'given' | 'received'

/**
 * The words TypeScript reserves: not names of parameters
 */
const RESERVED: ReadonlySet<string> = new Set([
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false',
    'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try',
    'typeof', 'var', 'void', 'while', 'with', 'as', 'implements', 'interface', 'let', 'package', 'private', 'protected', 'public', 'static',
    'yield', 'await', 'arguments', 'eval'
])

/**
 * The typed arrays of the arrays of numbers of the structs
 */
const TYPED_ARRAYS: Partial<Record<PrimitiveName, string>> = {
    schar: 'Int8Array', int8: 'Int8Array', uchar: 'Uint8Array', uint8: 'Uint8Array', short: 'Int16Array', int16: 'Int16Array',
    ushort: 'Uint16Array', uint16: 'Uint16Array', char16: 'Uint16Array', int: 'Int32Array', int32: 'Int32Array', uint: 'Uint32Array',
    uint32: 'Uint32Array', char32: 'Uint32Array', float: 'Float32Array', double: 'Float64Array'
}

/**
 * The name of a parameter in TypeScript: its C name, not a reserved word, not one of the others
 * @param parameter
 * @param index
 * @param taken
 */
function parameterName(parameter: Parameter, index: number, taken: Set<string>): string {
    let name: string = parameter.name ?? `arg${index}`
    if (RESERVED.has(name)) name = `${name}_`
    while (taken.has(name)) name = `${name}_`
    taken.add(name)
    return name
}

/**
 * The TypeScript types of C types, as the package converts their values
 */
export class TypeScriptTypes {

    readonly #names: ReadonlyMap<CType, string>

    /**
     * Types for the declarations of a library.
     * @param names The TypeScript names of its structs and unions.
     */
    constructor(names: ReadonlyMap<CType, string>) {
        this.#names = names
    }

    /**
     * The TypeScript type of a value of a C type.
     * @param type The C type.
     * @param flow Whether the value is given to the native code or received from it.
     */
    public type(type: CType, flow: Flow): string {
        switch (type.kind) {
            case 'primitive':
                return this.#primitive(type.name, flow)
            case 'enum':
                return this.#primitive(type.base, flow)
            case 'pointer':
                return this.#pointer(type.to, type.constTarget, flow)
            case 'array':
                return this.#array(type.of)
            case 'struct':
            case 'union':
                return this.#names.get(type) ?? this.#inline(type)
            case 'function':
                return this.#pointer(type, false, flow)
        }
    }

    /**
     * The TypeScript type of a function: of a native function, or of a JS callback the native code calls.
     * @param type The function type.
     * @param callback Whether it is a JS callback (its arguments received, its result given).
     */
    public functionType(type: FunctionType, callback: boolean = false): string {
        const taken: Set<string> = new Set()
        const parameters: string[] = type.parameters.map((parameter: Parameter, index: number): string => {
            return `${parameterName(parameter, index, taken)}: ${callback ? this.type(parameter.type, 'received') : this.#parameter(parameter)}`
        })
        if (type.variadic) parameters.push('...args: unknown[]')
        return `(${parameters.join(', ')}) => ${this.type(type.result, callback ? 'given' : 'received')}`
    }

    /**
     * The members of a struct or a union, as the lines of an interface (or of an object type).
     * @param record The struct or the union.
     * @param indent The indentation of the lines.
     */
    public members(record: RecordType, indent: string): string[] {
        return (record.members ?? []).map((member: Member): string => `${indent}${member.name}: ${this.type(member.type, 'received')}`)
    }

    /**
     * A parameter of a native function: an output parameter as the array or the object filled
     * @param parameter
     */
    #parameter(parameter: Parameter): string {
        if (parameter.direction !== 'in' && parameter.type.kind === 'pointer') {
            const to: CType = parameter.type.to
            if ((to.kind === 'struct' || to.kind === 'union') && to.members) return this.type(to, 'received')
            return `Out<${this.type(to, 'received')}>`
        }
        return this.type(parameter.type, 'given')
    }

    #primitive(name: PrimitiveName, flow: Flow): string {
        if (name === 'void') return 'void'
        if (name === 'bool') return 'boolean'
        if (primitiveBig(name)) return flow === 'given' ? 'bigint | number' : 'bigint'
        return 'number'
    }

    #pointer(to: CType, constTarget: boolean, flow: Flow): string {
        //The strings: char, char16_t, wchar_t
        if (to.kind === 'primitive' && (to.name === 'char' || to.name === 'char16' || to.name === 'wchar')) {
            return flow === 'given' && !constTarget ? 'string | Buffer | null' : 'string | null'
        }
        if (to.kind === 'function' && flow === 'given') return `(${this.functionType(to, true)}) | Pointer | null`
        if (flow !== 'given' || to.kind === 'function') return 'Pointer | null'
        //A struct or a union given to the function: its object too
        if ((to.kind === 'struct' || to.kind === 'union') && to.members) return `${this.type(to, 'received')} | Pointer | Buffer | ArrayBufferView | null`
        return 'Pointer | Buffer | ArrayBufferView | null'
    }

    #array(of: CType): string {
        if (of.kind === 'primitive' || of.kind === 'enum') {
            const name: PrimitiveName = of.kind === 'enum' ? of.base : of.name
            if (name === 'char' || name === 'wchar') return 'string'
            if (primitiveBig(name)) return 'bigint[]'
            if (name === 'bool') return 'boolean[]'
            return TYPED_ARRAYS[name] ?? 'number[]'
        }
        const element: string = this.type(of, 'received')
        return /^[\w.]+$/.test(element) ? `${element}[]` : `Array<${element}>`
    }

    /**
     * A struct or a union without a name (an anonymous member): an object type
     * @param record
     */
    #inline(record: RecordType): string {
        if (!record.members) return 'Pointer'
        return `{${record.members.map((member: Member): string => `${member.name}: ${this.type(member.type, 'received')}`).join(', ')}}`
    }
}
