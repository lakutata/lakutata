import {DTO_CLASS, DTO_SCHEMAS} from '../../constants/MetadataKey.js'
import {ObjectSchema, ValidationOptions, Validator} from '../../Validator.js'
import {IConstructor} from '../../interfaces/IConstructor.js'
import {defaultValidationOptions} from '../../constants/DefaultValue.js'
import {InvalidDTOValueException} from '../../exceptions/InvalidDTOValueException.js'


@(() => {
    return <TFunction extends IConstructor<any>>(target: TFunction): TFunction => {
        Reflect.defineMetadata(DTO_CLASS, true, target)
        return target
    }
})()
export class DTO {
    /**
     * 获取DTO的数据验证定义
     */
    public static schema<T extends DTO>(this: IConstructor<T>): ObjectSchema<T> {
        // console.log(Validator.Object(Reflect.getMetadata(DTO_SCHEMAS, this)))
        return Validator.Object(Reflect.getMetadata(DTO_SCHEMAS, this))
    }

    /**
     * 使用该DTO验证数据（同步）
     */
    public static validate<T extends DTO>(this: IConstructor<T>, data: any, options?: ValidationOptions): T {
        options = options ? Object.assign({}, defaultValidationOptions, options) : defaultValidationOptions
        const schema: ObjectSchema<T> = Validator.Object(Reflect.getMetadata(DTO_SCHEMAS, this))
        const {error, value} = schema.validate(data, options)
        if (error) throw new InvalidDTOValueException(error.message)
        return Object.assign(new this(), value)
    }

    /**
     * 使用该DTO验证数据（异步）
     * @param data
     * @param options
     */
    public static async validateAsync<T extends DTO>(this: IConstructor<T>, data: any, options?: ValidationOptions): Promise<T> {
        options = options ? Object.assign({}, defaultValidationOptions, options) : defaultValidationOptions
        const schema: ObjectSchema<T> = Validator.Object(Reflect.getMetadata(DTO_SCHEMAS, this))
        try {
            const value: T = await schema.validateAsync(data, options)
            return Object.assign(new this(), value)
        } catch (e) {
            throw new InvalidDTOValueException((e as Error).message)
        }
    }

    /**
     * 合并DTO并返回新的DTO
     */
    public static concat<T extends typeof this>(...args: T[]): T {
        const anonymousDTO = class extends this {
        }
        let anonymousDTOSchema = Reflect.getMetadata(DTO_SCHEMAS, this)
        args.forEach(dto => anonymousDTOSchema = Object.assign(anonymousDTOSchema, Reflect.getMetadata(DTO_SCHEMAS, dto)))
        Reflect.defineMetadata(DTO_SCHEMAS, anonymousDTOSchema, anonymousDTO)
        return Object.assign(anonymousDTO, ...args)
    }
}
