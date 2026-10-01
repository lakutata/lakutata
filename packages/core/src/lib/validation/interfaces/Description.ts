import {Types} from '../types/Types.js'
import {ValidationOptions} from './ValidationOptions.js'

/**
 * A schema description (describe())
 */
export interface Description {
    type?: Types | string
    label?: string
    description?: string
    flags?: object
    notes?: string[]
    tags?: string[]
    metas?: any[]
    example?: any[]
    valids?: any[]
    invalids?: any[]
    unit?: string
    options?: ValidationOptions

    [key: string]: any
}
