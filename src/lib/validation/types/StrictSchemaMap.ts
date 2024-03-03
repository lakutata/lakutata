import {ObjectPropertiesSchema} from './ObjectPropertiesSchema.js'

export type StrictSchemaMap<TSchema = any> = {
    [key in keyof TSchema]-?: ObjectPropertiesSchema<TSchema[key]>
}
