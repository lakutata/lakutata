import {DTO_CLASS, DTO_SCHEMAS} from '../../constants/MetadataKey.js'
import {ObjectSchema, ValidationOptions, Validator} from '../../Validator.js'
import {IConstructor} from '../../interfaces/IConstructor.js'
import {defaultValidationOptions} from '../../constants/DefaultValue.js'
import {InvalidDTOValueException} from '../../exceptions/InvalidDTOValueException.js'
import {As, ConfigureObjectProperties, ParentConstructor} from '../../Utilities.js'
import {appendAsyncConstructor} from 'async-constructor'

@(() => {
    return <TFunction extends IConstructor<any>>(target: TFunction): TFunction => {
        Reflect.defineMetadata(DTO_CLASS, true, target)
        return target
    }
})()
export class DTO {

    constructor(properties: Record<string, any> = {}, validateOptions: ValidationOptions = defaultValidationOptions, async: boolean = false) {
        validateOptions = Object.assign({}, defaultValidationOptions, validateOptions)
        const schema: ObjectSchema = As<IConstructor<DTO>>(this.constructor).schema()
        if (async) {
            appendAsyncConstructor(this, async () => {
                try {
                    ConfigureObjectProperties(this, await schema.validateAsync(properties, validateOptions))
                } catch (e) {
                    throw new InvalidDTOValueException((As<Error>(e).message))
                }
            })
        } else {
            const {error, value} = schema.validate(properties, validateOptions)
            if (error) throw new InvalidDTOValueException(error.message)
            ConfigureObjectProperties(this, value)
        }
    }

    /**
     * 获取DTO的数据验证定义
     */
    public static schema<T extends DTO>(this: IConstructor<T>): ObjectSchema<T> {
        const parentConstructor: IConstructor<T> | null = ParentConstructor(this)
        const parentSchema: ObjectSchema<T> = (parentConstructor && parentConstructor.schema) ? parentConstructor.schema() : Validator.Object()
        return parentSchema.concat(Validator.Object(Reflect.getOwnMetadata(DTO_SCHEMAS, this) ? Reflect.getOwnMetadata(DTO_SCHEMAS, this) : {}))
    }

    /**
     * 使用该DTO验证数据（同步）
     */
    public static validate<T extends DTO>(this: IConstructor<T>, data: any, options?: ValidationOptions): T {
        options = options ? Object.assign({}, defaultValidationOptions, options) : defaultValidationOptions
        return new this(data, options, false)
    }

    /**
     * 使用该DTO验证数据（异步）
     * @param data
     * @param options
     */
    public static async validateAsync<T extends DTO>(this: IConstructor<T>, data: any, options?: ValidationOptions): Promise<T> {
        options = options ? Object.assign({}, defaultValidationOptions, options) : defaultValidationOptions
        return await As<Promise<T>>(new this(data, options, true))
    }

    /**
     * 验证数据是否符合DTO（同步）
     * @param data
     * @param options
     */
    public static isValid(data: any, options?: ValidationOptions): boolean {
        try {
            this.validate(data, options)
            return true
        } catch (e) {
            return false
        }
    }

    /**
     * 验证数据是否符合DTO（异步）
     * @param data
     * @param options
     */
    public static async isValidAsync(data: any, options?: ValidationOptions): Promise<boolean> {
        try {
            await this.validateAsync(data, options)
            return true
        } catch (e) {
            return false
        }
    }

    [prop: string]: any
}
