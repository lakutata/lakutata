import {DataValidator, DefaultValidationOptions} from '../base/internal/DataValidator.js'
import {Schema, SchemaMap, ValidationOptions} from 'joi'
import {AppendAsyncConstructor} from '../base/async-constructor/Append.js'
import {
    GetObjectPropertySchemasByPrototype, ObjectPropertySchemaMap
} from '../base/internal/ObjectSchemaValidation.js'
import {InvalidValueException} from '../../exceptions/dto/InvalidValueException.js'
import {As} from '../base/func/As.js'

export class DTO extends DataValidator {

    #props: Record<string, any>

    #instantiated: boolean = false


    #objectSchema(): Schema {
        const schemaMap: SchemaMap = {}
        GetObjectPropertySchemasByPrototype(this).forEach((propertySchema: Schema, propertyKey: string) => {
            schemaMap[propertyKey] = propertySchema
        })
        return DTO.Object(schemaMap)
    }

    /**
     * Instantiate
     * @private
     */
    #instantiate(): void {
        this.#instantiated = true
    }

    /**
     * Sync validation
     * @param props
     * @private
     */
    #validateSync(props: Record<string, any>): Record<string, any> {
        return DTO.validate(props, this.#objectSchema(), this.validateOptions())
    }

    /**
     * Async validation
     * @param props
     * @private
     */
    async #validateAsync(props: Record<string, any>): Promise<Record<string, any>> {
        return await DTO.validateAsync(props, this.#objectSchema(), this.validateOptions())
    }

    constructor(props: Record<string, any> = {}, async: boolean = false) {
        super()
        //Create DTO proxy object
        const DTOInstanceProxy: this = new Proxy(this, {
            get(target, p: string | symbol, receiver: any): any {
                console.log('Get:', p)
                return Reflect.get(target, p, receiver)
            },
            set: (target, prop: string | symbol, value, receiver) => {
                if (this.#instantiated) {
                    // 在这里可以添加一些处理逻辑
                    console.log(`设置属性: ${prop.toString()} = ${value}`, target)
                    //TODO 触发验证
                }
                return Reflect.set(target, prop, value, receiver)
            }
        })
        if (async) {
            AppendAsyncConstructor(DTOInstanceProxy, async (): Promise<void> => {
                try {
                    const validProps: Record<string, any> = await DTO.validateAsync(props, this.#objectSchema(), this.validateOptions())
                    Object.keys(validProps).forEach((propertyKey: string) => this[propertyKey] = validProps[propertyKey])
                } catch (e) {
                    throw new InvalidValueException((As<Error>(e).message))
                }
                this.#instantiate()
            })
        } else {
            try {
                const validProps: Record<string, any> = DTO.validate(props, this.#objectSchema(), this.validateOptions())
                Object.keys(validProps).forEach((propertyKey: string) => this[propertyKey] = validProps[propertyKey])
            } catch (e) {
                throw new InvalidValueException((As<Error>(e).message))
            }
            this.#instantiate()
            console.log('getOwnPropertyNames:', Object.getOwnPropertyNames(this), this)
            return DTOInstanceProxy
        }
    }

    /**
     * Validate options for current DTO instance
     */
    public validateOptions(): ValidationOptions {
        return DefaultValidationOptions
    }

    [prop: string | symbol]: any
}
