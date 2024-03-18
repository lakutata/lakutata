import {IsNonPrimitiveSubsetUnion, type NullableType} from 'joi'
import {AlternativesSchema} from '../interfaces/AlternativesSchema.js'
import {StringSchema} from '../interfaces/StringSchema.js'
import {NumberSchema} from '../interfaces/NumberSchema.js'
import {BooleanSchema} from '../interfaces/BooleanSchema.js'
import {DateSchema} from '../interfaces/DateSchema.js'
import {BinarySchema} from '../interfaces/BinarySchema.js'
import {ArraySchema} from '../interfaces/ArraySchema.js'
import {StrictSchemaMap} from './StrictSchemaMap.js'
import {ObjectSchema} from '../interfaces/ObjectSchema.js'

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
