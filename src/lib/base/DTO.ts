import {DTO_CLASS, DTO_INDEX_SIGNATURE_SCHEMAS, DTO_SCHEMAS} from '../../constants/MetadataKey'
import {ObjectSchema, Schema, ValidationOptions, Validator} from '../../exports/Validator'
import {IConstructor} from '../../interfaces/IConstructor'
import {defaultValidationOptions} from '../../constants/DefaultValue'
import {InvalidDTOValueException} from '../../exceptions/InvalidDTOValueException'
import {As, ConfigureObjectProperties} from '../../exports/Utilities'
import {AppendAsyncConstructor} from './async-constructor/Append'
import {Helper} from '../../exports/Helper'

/**
 * DTO基础类
 * 在所有继承DTO的子类当中，使用验证器的情况下属性必须要添加“declare”的关键字，否则将会导致验证结果出现空值的情况出现
 */
@(() => {
    return <TFunction extends IConstructor<any>>(target: TFunction): TFunction => {
        Reflect.defineMetadata(DTO_CLASS, true, target)
        return target
    }
})()
export class DTO {

    /**
     * DTO基类构造函数
     * @param properties
     * @param validateOptions
     * @param async
     */
    constructor(properties: Record<string, any> = {}, validateOptions: ValidationOptions = defaultValidationOptions, async: boolean = false) {
        validateOptions = Object.assign({}, defaultValidationOptions, validateOptions)
        const schema: ObjectSchema = As<IConstructor<DTO>>(this.constructor).schema()
        if (async) {
            AppendAsyncConstructor(this, async () => {
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
     * 获取DTO的索引签名验证定义
     * @protected
     */
    protected static patternSchemas<T extends DTO>(this: IConstructor<T>): Schema[] {
        const parentConstructor: IConstructor<T> | null = Helper.ParentConstructor(this)
        const parentIndexSignatureSchemas: Schema[] = (parentConstructor && parentConstructor.patternSchemas) ? parentConstructor.patternSchemas() : []
        const selfIndexSignatureSchemas: Schema[] = Reflect.hasOwnMetadata(DTO_INDEX_SIGNATURE_SCHEMAS, this) ? Reflect.getOwnMetadata(DTO_INDEX_SIGNATURE_SCHEMAS, this) : []
        return (parentIndexSignatureSchemas ? parentIndexSignatureSchemas : []).concat(selfIndexSignatureSchemas)
    }

    /**
     * 获取DTO的字段验证定义
     * @protected
     */
    protected static fieldSchema<T extends DTO>(this: IConstructor<T>): ObjectSchema<T> {
        const parentConstructor: IConstructor<T> | null = Helper.ParentConstructor(this)
        const parentSchema: ObjectSchema<T> = (parentConstructor && parentConstructor.fieldSchema) ? parentConstructor.fieldSchema() : Validator.Object()
        return parentSchema.concat(Validator.Object(Reflect.hasOwnMetadata(DTO_SCHEMAS, this) ? Reflect.getOwnMetadata(DTO_SCHEMAS, this) : {}))
    }

    /**
     * 获取DTO的数据验证定义
     */
    public static schema(): ObjectSchema<DTO> {
        const patternAlternativeSchemas: Schema[] = this.patternSchemas()
        const objectSchema: ObjectSchema<DTO> = this.fieldSchema()
        return patternAlternativeSchemas.length ? objectSchema.pattern(Validator.String(), Validator.Alternatives().try(...patternAlternativeSchemas)) : objectSchema
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

    /**
     * 不严格限制其他字段的属性
     */
    [prop: string]: any
}
