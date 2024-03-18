import {type IsNonPrimitiveSubsetUnion, type NullableType} from 'joi'
import {type AlternativesSchema} from '../interfaces/AlternativesSchema.js'
import {type StringSchema} from '../interfaces/StringSchema.js'
import {type NumberSchema} from '../interfaces/NumberSchema.js'
import {type BooleanSchema} from '../interfaces/BooleanSchema.js'
import {type DateSchema} from '../interfaces/DateSchema.js'
import {type BinarySchema} from '../interfaces/BinarySchema.js'
import {type ArraySchema} from '../interfaces/ArraySchema.js'
import {type StrictSchemaMap} from './StrictSchemaMap.js'
import {type ObjectSchema} from '../interfaces/ObjectSchema.js'

export type ObjectPropertiesSchema<T = any> =
    true extends IsNonPrimitiveSubsetUnion<Exclude<T, undefined | null>>
        ? AlternativesSchema
        : T extends NullableType<string>
            ? StringSchema
            : T extends NullableType<number>
                ? NumberSchema
                : T extends NullableType<bigint>
                    ? NumberSchema
                    : T extends NullableType<boolean>
                        ? BooleanSchema
                        : T extends NullableType<Date>
                            ? DateSchema
                            : T extends NullableType<Buffer>
                                ? BinarySchema
                                : T extends NullableType<Array<any>>
                                    ? ArraySchema
                                    : T extends NullableType<object>
                                        ? (StrictSchemaMap<T> | ObjectSchema<T>)
                                        : never
