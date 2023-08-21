import 'reflect-metadata'
import {ArraySchema, Schema, SchemaMap, ValidationError, ValidationOptions, Validator} from '../exports/Validator'
import {DTO} from '../lib/base/DTO'
import {isAsyncFunction} from 'util/types'
import {InvalidMethodAcceptException} from '../exceptions/validation/InvalidMethodAcceptException'
import {IConstructor} from '../interfaces/IConstructor'
import {DTO_CLASS, DTO_INDEX_SIGNATURE_SCHEMAS, DTO_SCHEMAS} from '../constants/MetadataKey'
import {defaultValidationOptions} from '../constants/DefaultValue'
import {InvalidMethodReturnException} from '../exceptions/validation/InvalidMethodReturnException'
import {As} from '../exports/Utilities'

type TFunction = (...args: any[]) => any | Promise<any>

type DTOSubClass<T extends DTO> = {
    [K in keyof T]: T[K];
}

/**
 * DTO类索引签名验证声明
 * [key:string]:{声明的类型Schema}
 * @constructor
 */
export function IndexSignature<T extends typeof DTO>(schema: Schema, ...schemas: Schema[]): (constructor: T) => T {
    return function <T extends typeof DTO>(constructor: T): T {
        const patternSchemas: Schema[] = [schema, ...schemas]
        Reflect.defineMetadata(DTO_INDEX_SIGNATURE_SCHEMAS, patternSchemas, constructor)
        return constructor
    }
}

/**
 * DTO类属性参数验证声明
 * @constructor
 */
export function Expect<T extends DTO>(schema: Schema): (target: DTOSubClass<T>, propertyKey: keyof T) => void {
    return function <T extends DTO>(target: DTOSubClass<T>, propertyKey: keyof T): void {
        if (!Reflect.hasOwnMetadata(DTO_SCHEMAS, target.constructor)) Reflect.defineMetadata(DTO_SCHEMAS, {}, target.constructor)
        const schemas: SchemaMap = Reflect.getOwnMetadata(DTO_SCHEMAS, target.constructor)
        schemas[propertyKey] = schema
        Reflect.defineMetadata(DTO_SCHEMAS, schemas, target.constructor)
    }
}

/**
 * 方法参数验证
 * @constructor
 */
export function Accept(argumentSchemas: Schema | Schema[], options?: ValidationOptions): (target: Object, propertyKey: string, descriptor: TypedPropertyDescriptor<TFunction>) => TypedPropertyDescriptor<TFunction>
export function Accept(DTOs: IConstructor<DTO> | IConstructor<DTO>[], options?: ValidationOptions): (target: Object, propertyKey: string, descriptor: TypedPropertyDescriptor<TFunction>) => TypedPropertyDescriptor<TFunction>
export function Accept(inp: Schema | Schema[] | IConstructor<DTO> | IConstructor<DTO>[], options?: ValidationOptions): any {
    return function (target: Object, propertyKey: string, descriptor: TypedPropertyDescriptor<TFunction>): TypedPropertyDescriptor<TFunction> | void {
        //方法修饰器
        const inputs: (Schema | IConstructor<DTO>)[] = Array.isArray(inp) ? inp : [inp]
        const argumentSchemas: Schema[] = []
        inputs.forEach(input => {
            if (Reflect.hasMetadata(DTO_CLASS, input)) {
                //DTO类的构造函数
                argumentSchemas.push(Validator.Object(Reflect.getMetadata(DTO_SCHEMAS, input)))
            } else {
                //Schema实例
                argumentSchemas.push(As<Schema>(input))
            }
        })
        options = options ? Object.assign({}, defaultValidationOptions, options) : defaultValidationOptions
        descriptor.writable = false
        const originalMethod: (...args: any[]) => any | Promise<any> = descriptor.value as any
        const schema: ArraySchema = Validator.Array().ordered(...argumentSchemas)
        const argumentSchemaLength: number = Array.isArray(argumentSchemas) ? argumentSchemas.length : 1
        if (isAsyncFunction(originalMethod)) {
            descriptor.value = async function (...args: any[]): Promise<any> {
                const argumentCount: number = args.length - argumentSchemaLength
                try {
                    args = await Validator.validateAsync(args, schema.concat(Validator.Array().ordered(...new Array(argumentCount >= 0 ? argumentCount : 0).fill(Validator.Any()))), options)
                } catch (e) {
                    throw new InvalidMethodAcceptException('Method [{propertyKey}] accept argument {reason}', {
                        propertyKey: propertyKey,
                        reason: (e as Error).message
                    })
                }
                return originalMethod.apply(this, args)
            }
        } else {
            descriptor.value = function (...args: any[]): any {
                const argumentCount: number = args.length - argumentSchemaLength
                try {
                    args = Validator.validate(args, schema.concat(Validator.Array().ordered(...new Array(argumentCount >= 0 ? argumentCount : 0).fill(Validator.Any()))), options)
                } catch (e) {
                    throw new InvalidMethodAcceptException('Method [{propertyKey}] accept argument {reason}', {
                        propertyKey: propertyKey,
                        reason: (e as Error).message
                    })
                }
                return originalMethod.apply(this, args)
            }
        }
        return descriptor
    }
}

/**
 * 方法返回值验证
 * @param returnSchema
 * @param options
 * @constructor
 */
export function Return(returnSchema: Schema, options?: ValidationOptions): (target: Object, propertyKey: string, descriptor: TypedPropertyDescriptor<TFunction>) => TypedPropertyDescriptor<TFunction>
export function Return(DTO: IConstructor<DTO>, options?: ValidationOptions): (target: Object, propertyKey: string, descriptor: TypedPropertyDescriptor<TFunction>) => TypedPropertyDescriptor<TFunction>
export function Return(inp: Schema | IConstructor<DTO>, options?: ValidationOptions): any {
    return function (target: Object, propertyKey: string, descriptor: TypedPropertyDescriptor<TFunction>): TypedPropertyDescriptor<TFunction> | void {
        let schema: Schema
        if (Reflect.hasMetadata(DTO_CLASS, inp)) {
            //DTO类的构造函数
            schema = Validator.Object(Reflect.getMetadata(DTO_SCHEMAS, inp))
        } else {
            //Schema实例
            schema = inp as Schema
        }
        options = options ? Object.assign({}, defaultValidationOptions, options) : defaultValidationOptions
        descriptor.writable = false
        const originalMethod: (...args: any[]) => any | Promise<any> = descriptor.value as any
        if (isAsyncFunction(originalMethod)) {
            descriptor.value = async function (...args: any[]) {
                const asyncResult = await originalMethod.apply(this, args)
                try {
                    if (asyncResult === undefined) throw new Error('is undefined')
                    return await schema.validateAsync(asyncResult, options)
                } catch (e) {
                    throw new InvalidMethodReturnException('Method [{propertyKey}] return value {reason}', {
                        propertyKey: propertyKey,
                        reason: (e as Error).message
                    })
                }
            }
        } else {
            descriptor.value = function (...args: any[]) {
                const syncResult = originalMethod.apply(this, args)
                let {error, value} = schema.validate(syncResult, options)
                if (!error && syncResult === undefined) error = new Error('is undefined') as ValidationError
                if (error) {
                    throw new InvalidMethodReturnException('Method [{propertyKey}] return value {reason}', {
                        propertyKey: propertyKey,
                        reason: error.message
                    })
                }
                return value
            }
        }
        return descriptor
    }
}
