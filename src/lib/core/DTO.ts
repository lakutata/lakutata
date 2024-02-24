import {DataValidator, DefaultValidationOptions} from '../base/internal/DataValidator.js'
import {Schema, SchemaMap, ValidationOptions} from 'joi'
import {AppendAsyncConstructor} from '../base/async-constructor/Append.js'
import {
    GetObjectPropertySchemasByPrototype,
    GetObjectSchemaByConstructor,
    GetObjectSchemaByPrototype,
    GetObjectValidateOptions,
    ObjectPropertySchemaMap
} from '../base/internal/ObjectSchemaValidation.js'
import {InvalidValueException} from '../../exceptions/dto/InvalidValueException.js'
import {As} from '../base/func/As.js'
import {IsNativeFunction} from '../base/func/IsNativeFunction.js'

export class DTO extends DataValidator {

    #instantiated: boolean = false

    get #objectSchema(): Schema {
        return GetObjectSchemaByPrototype(this)
    }

    /**
     * Instantiate
     * @private
     */
    #instantiate(): void {
        this.#instantiated = true
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
                        ...GetObjectValidateOptions(this),
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
                        ...GetObjectValidateOptions(this),
                        noDefaults: true
                    })
                }
                return Reflect.deleteProperty(target, prop)
            }
        })
        if (async) {
            AppendAsyncConstructor(DTOInstanceProxy, async (): Promise<void> => {
                try {
                    const validProps: Record<string, any> = await DTO.validateAsync(props, this.#objectSchema, GetObjectValidateOptions(this))
                    Object.keys(validProps).forEach((propertyKey: string) => this[propertyKey] = validProps[propertyKey])
                } catch (e) {
                    throw new InvalidValueException((As<Error>(e).message))
                }
                this.#instantiate()
            })
        } else {
            try {
                const validProps: Record<string, any> = DTO.validate(props, this.#objectSchema, GetObjectValidateOptions(this))
                Object.keys(validProps).forEach((propertyKey: string) => this[propertyKey] = validProps[propertyKey])
            } catch (e) {
                throw new InvalidValueException((As<Error>(e).message))
            }
            this.#instantiate()
            return DTOInstanceProxy
        }
    }

    [prop: string | symbol]: any

    /**
     * DTO schema
     * @constructor
     */
    public static get Schema(): Schema {
        return GetObjectSchemaByConstructor(this)
    }
}
