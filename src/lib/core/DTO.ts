import {DataValidator, DefaultValidationOptions} from '../base/internal/DataValidator.js'
import {Schema, SchemaMap, ValidationOptions} from 'joi'
import {AppendAsyncConstructor} from '../base/async-constructor/Append.js'
import {
    GetObjectPropertySchemasByPrototype, ObjectPropertySchemaMap
} from '../base/internal/ObjectSchemaValidation.js'
import {InvalidValueException} from '../../exceptions/dto/InvalidValueException.js'
import {As} from '../base/func/As.js'
import {IsNativeFunction} from '../base/func/IsNativeFunction.js'

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
            set: (target, prop: string | symbol, value, receiver) => {
                if (this.#instantiated && typeof prop !== 'symbol') {
                    const objectPropertySchemaMap: ObjectPropertySchemaMap = GetObjectPropertySchemasByPrototype(this)
                    const propertySchema: Schema | undefined = objectPropertySchemaMap.get(prop)
                    if (propertySchema) value = DTO.validate(value, propertySchema, {
                        ...this.validateOptions(),
                        noDefaults: true
                    })
                }
                return Reflect.set(target, prop, value, receiver)
            },
            deleteProperty: (target, prop: string | symbol): boolean => {
                if (this.#instantiated && typeof prop !== 'symbol' && !IsNativeFunction(target[prop])) {
                    const objectPropertySchemaMap: ObjectPropertySchemaMap = GetObjectPropertySchemasByPrototype(this)
                    const propertySchema: Schema | undefined = objectPropertySchemaMap.get(prop)
                    if (propertySchema) DTO.validate(undefined, propertySchema, {
                        ...this.validateOptions(),
                        noDefaults: true
                    })
                }
                return Reflect.deleteProperty(target, prop)
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
