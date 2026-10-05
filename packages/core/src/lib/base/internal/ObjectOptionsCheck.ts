import {BaseObject} from '../BaseObject.js'
import {LoadObjectOptions, OBJECT_ID} from '../../../options/LoadObjectOptions.js'
import {getObjectConfigurableProperties, ObjectConfigurablePropertyMap} from './ObjectConfiguration.js'
import {DTO} from '../../dto/DTO.js'
import {InvalidValueException} from '../../../exceptions/dto/InvalidValueException.js'
import {InvalidObjectOptionsException} from '../../../exceptions/di/InvalidObjectOptionsException.js'
import {throwWarning} from '../../foundation/ThrowWarning.js'
import {As} from '@lakutata/utils/As'

/**
 * The options of the declarations which are not options of the object
 */
const DECLARATION_OPTIONS: Set<string> = new Set(['class', 'id'])

/**
 * Check the options of the objects declared in a module, before any of them is created (an object never created is
 * checked too): an invalid value of a configurable property is an error, an option which is not a configurable property
 * and which the class does not accept (see BaseObject.acceptsOption()) is a warning. The values are validated as the
 * objects validate them, without their transforms. The options not given are not checked (they may be given when the
 * object is got), nor the properties validated asynchronously (by external rules), which the object validates
 * @param loadOptions
 * @constructor
 */
export function checkObjectOptions(loadOptions: (LoadObjectOptions | typeof BaseObject | string)[]): void {
    const errors: string[] = []
    const warnings: string[] = []
    for (const declaration of loadOptions) {
        if (typeof declaration !== 'object' || !declaration || typeof declaration.class !== 'function') continue
        const target: typeof BaseObject = declaration.class
        const id: string | symbol | undefined = declaration[OBJECT_ID]
        const object: string = typeof id === 'string' ? `"${id}" (${target.name})` : target.name
        const properties: ObjectConfigurablePropertyMap = getObjectConfigurableProperties(As<BaseObject>(target.prototype))
        for (const name of Object.keys(declaration)) {
            const value: unknown = declaration[name]
            if (DECLARATION_OPTIONS.has(name) || value === undefined) continue
            const property: ReturnType<ObjectConfigurablePropertyMap['get']> = properties.get(name)
            if (!property) {
                if (!target.acceptsOption(name, value)) warnings.push(unknownOptionMessage(object, name, properties))
                continue
            }
            try {
                DTO.validate(value, property.schema, {targetName: name})
            } catch (e) {
                //Not an invalid value: a schema with external rules, which only the asynchronous validation runs
                if (!(e instanceof InvalidValueException)) continue
                errors.push(`The option "${name}" of ${object} is invalid: ${e.message}`)
            }
        }
    }
    warnings.forEach((warning: string): unknown => throwWarning(warning))
    if (errors.length) throw new InvalidObjectOptionsException(errors.join('\n'))
}

/**
 * The warning of an option which is not a configurable property
 * @param object
 * @param name
 * @param properties
 * @constructor
 */
function unknownOptionMessage(object: string, name: string, properties: ObjectConfigurablePropertyMap): string {
    const names: string[] = [...properties.keys()].filter((key: string | symbol): key is string => typeof key === 'string').sort()
    const hint: string = names.length ? `its configurable properties: ${names.join(', ')}` : 'it has no configurable property'
    return `The option "${name}" of ${object} is not a configurable property, it is ignored (${hint})`
}
