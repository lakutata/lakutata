import koffi, {type LibraryHandle} from 'koffi'
import {NativeDeclarationException} from '../../exceptions/NativeDeclarationException.js'
import {type CType, type FunctionDeclaration, type FunctionType, type Parameter, primitiveBig, typeText} from '../declarations/Types.js'
import {type Converter, type KoffiType, type KoffiTypes, toBigInt} from './KoffiTypes.js'

/**
 * How a function is bound
 */
export interface BindOptions {
    /**
     * Whether it runs in a thread of the pool, returning a promise
     */
    readonly async?: boolean
    /**
     * Frees the strings it gives (its result, its output strings) once read
     */
    readonly free?: (pointer: unknown) => void
    /**
     * Its 64-bit integers (its result, its output integers) as numbers rather than bigints: a RangeError when one is not
     * a safe integer
     */
    readonly int64?: 'bigint' | 'number'
    /**
     * The asynchronous calls of the library: counted, refused once it is closed
     */
    readonly calls?: CallTracker
}

/**
 * Counts the asynchronous calls of a library
 */
export interface CallTracker {
    /**
     * Before a call: throws once the library is closed
     */
    start(): void

    /**
     * Once a call has returned
     */
    end(): void
}

/**
 * The koffi types of the extra arguments of a variadic function, by the C type names given before them
 */
export type VariadicTypes = (text: string) => KoffiType

/**
 * A step of a call: what is done with an argument before the call, and after it
 */
interface ArgumentStep {
    readonly index: number
    readonly before?: (value: any) => any
    readonly after?: (given: any, passed: any) => void
}

/**
 * A 64-bit integer as a number, when it is a safe one
 * @param value
 */
export function toSafeNumber(value: unknown): unknown {
    if (typeof value !== 'bigint') return value
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError(`${value} is not a safe integer: declare the function without int64: 'number' to get a bigint`)
    return Number(value)
}

/**
 * Whether a type is a pointer to a string type (char *, char16_t *, wchar_t *)
 * @param type
 */
function isString(type: CType): boolean {
    return type.kind === 'pointer' && type.to.kind === 'primitive' && ['char', 'char16', 'wchar'].includes(type.to.name)
}

/**
 * The koffi type of a string type, freed by a function once read
 * @param type
 * @param free
 */
function disposableString(type: CType, free: (pointer: unknown) => void): KoffiType {
    const name: string = (type as { to: { name: string } }).to.name
    return koffi.disposable(name === 'char' ? 'char *' : name === 'char16' ? 'char16_t *' : 'wchar_t *', free)
}

/**
 * A JS function given as a callback, its arguments and its result converted when its prototype has 64-bit integers or
 * structs with bitfields; the same function otherwise
 * @param type
 * @param types
 * @param callback
 */
export function convertedCallback(type: FunctionType, types: KoffiTypes, callback: (...args: any[]) => any): (...args: any[]) => any {
    const steps: (Converter | null)[] = type.parameters.map((parameter: Parameter): Converter | null => types.converter(parameter.type))
    const result: Converter | null = types.converter(type.result)
    if (!steps.some((step: Converter | null): boolean => !!step?.fromNative) && !result?.toNative) return callback
    return (...args: any[]): any => {
        for (let i: number = 0; i < steps.length; i++) if (steps[i]?.fromNative) args[i] = steps[i]!.fromNative!(args[i])
        const value: any = callback(...args)
        return result?.toNative ? result.toNative(value) : value
    }
}

/**
 * The steps of the arguments of a function: the callbacks converted, the structs with bitfields written, the output
 * integers and structs read back as the package gives them
 * @param type
 * @param types
 * @param options
 */
function argumentSteps(type: FunctionType, types: KoffiTypes, options: BindOptions): ArgumentStep[] {
    const steps: ArgumentStep[] = []
    type.parameters.forEach((parameter: Parameter, index: number): void => {
        const target: CType | undefined = parameter.type.kind === 'pointer' ? parameter.type.to : undefined
        if (parameter.direction === 'in') {
            if (target?.kind === 'function') {
                const prototype: FunctionType = target
                const probe = (): void => undefined
                if (convertedCallback(prototype, types, probe) === probe) return
                steps.push({index: index, before: (value: any): any => typeof value === 'function' ? convertedCallback(prototype, types, value) : value})
                return
            }
            const converter: Converter | null = types.converter(target && (target.kind === 'struct' || target.kind === 'union') ? target : parameter.type)
            if (converter?.toNative && (parameter.type.kind !== 'pointer' || target?.kind === 'struct' || target?.kind === 'union')) {
                steps.push({index: index, before: (value: any): any => isPlainObject(value) ? converter.toNative!(value) : value})
            }
            return
        }
        if (!target) return
        //An output integer: the array given gets a bigint (or a number, with int64: 'number')
        if ((target.kind === 'primitive' && primitiveBig(target.name)) || (target.kind === 'enum' && primitiveBig(target.base))) {
            const convert: (value: unknown) => unknown = options.int64 === 'number' ? toSafeNumber : toBigInt
            steps.push({index: index, after: (given: any): void => {
                if (Array.isArray(given)) given[0] = convert(given[0])
            }})
            return
        }
        //An output struct: filled through an object koffi knows, then given back as the package gives it
        const converter: Converter | null = types.converter(target)
        if (converter && (target.kind === 'struct' || target.kind === 'union')) {
            steps.push({
                index: index,
                before: (value: any): any => isPlainObject(value) ? (parameter.direction === 'inout' && converter.toNative ? converter.toNative(value) : {...value}) : value,
                after: (given: any, passed: any): void => {
                    if (isPlainObject(given) && passed !== given) Object.assign(given, converter.fromNative ? converter.fromNative(passed) : passed)
                }
            })
        }
    })
    return steps
}

/**
 * Whether a value is a plain object (a struct given as an object), not a pointer, a buffer or a koffi union
 * @param value
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !ArrayBuffer.isView(value) && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

/**
 * A function of a library, bound by its declaration: the function of koffi itself when nothing has to be converted,
 * else a function converting its arguments and its result; a function returning a promise when asynchronous
 * @param library
 * @param declaration
 * @param types
 * @param variadicTypes
 * @param options
 */
export function bindFunction(library: LibraryHandle, declaration: FunctionDeclaration, types: KoffiTypes, variadicTypes: VariadicTypes, options: BindOptions = {}): (...args: any[]) => any {
    const type: FunctionType = declaration.type
    if (options.async && type.variadic) throw new NativeDeclarationException(`The variadic function ${declaration.name} cannot be called asynchronously`)
    const result: KoffiType = options.free && isString(type.result) ? disposableString(type.result, options.free) : types.type(type.result)
    const parameters: KoffiType[] = type.parameters.map((parameter: Parameter): KoffiType => {
        const target: CType | undefined = parameter.type.kind === 'pointer' ? parameter.type.to : undefined
        if (parameter.direction === 'in') return types.type(parameter.type)
        if (!target) throw new NativeDeclarationException(`The parameter ${parameter.name ?? ''} of ${declaration.name} is ${parameter.direction === 'out' ? '_Out_' : '_Inout_'} but not a pointer (${typeText(parameter.type)})`.replace('  ', ' '))
        const pointed: KoffiType = options.free && isString(target) ? koffi.pointer(disposableString(target, options.free)) : types.type(parameter.type)
        return parameter.direction === 'out' ? koffi.out(pointed) : koffi.inout(pointed)
    })
    let bound: ReturnType<LibraryHandle['func']>
    try {
        bound = library.func(`__${type.convention}`, declaration.symbol, result, type.variadic ? [...parameters, '...'] : parameters)
    } catch (error) {
        throw new NativeDeclarationException(`The function ${declaration.name} cannot be bound (${declaration.symbol}): ${(error as Error).message}`)
    }
    const steps: ArgumentStep[] = argumentSteps(type, types, options)
    const resultConverter: ((value: any) => any) | undefined = options.int64 === 'number' && (type.result.kind === 'primitive' && primitiveBig(type.result.name)) ? toSafeNumber : types.converter(type.result)?.fromNative
    const fixed: number = type.parameters.length
    const prepare = (args: any[]): any[] => {
        const passed: any[] = args.slice()
        for (const step of steps) if (step.before) passed[step.index] = step.before(args[step.index])
        //The extra arguments of a variadic function: the koffi type of each C type name given
        if (type.variadic) for (let i: number = fixed; i < passed.length; i += 2) if (typeof passed[i] === 'string') passed[i] = variadicTypes(passed[i])
        return passed
    }
    const finish = (args: any[], passed: any[], value: any): any => {
        for (const step of steps) if (step.after) step.after(args[step.index], passed[step.index])
        return resultConverter ? resultConverter(value) : value
    }
    if (!options.async) {
        if (!steps.length && !resultConverter && !type.variadic) return bound
        return (...args: any[]): any => {
            const passed: any[] = prepare(args)
            return finish(args, passed, bound(...passed))
        }
    }
    return (...args: any[]): Promise<any> => {
        //Refused once the library is closed: a rejected promise, as every failure of the call
        try {
            options.calls?.start()
        } catch (error) {
            return Promise.reject(error)
        }
        let passed: any[]
        try {
            passed = prepare(args)
        } catch (error) {
            options.calls?.end()
            return Promise.reject(error)
        }
        return new Promise((resolve: (value: any) => void, reject: (error: Error) => void): void => {
            try {
                bound.async(...passed, (error: Error | null, value: any): void => {
                    options.calls?.end()
                    if (error) return reject(error)
                    try {
                        resolve(finish(args, passed, value))
                    } catch (conversion) {
                        reject(conversion as Error)
                    }
                })
            } catch (error) {
                options.calls?.end()
                reject(error as Error)
            }
        })
    }
}
