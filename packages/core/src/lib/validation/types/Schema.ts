import {AnySchema} from '../interfaces/AnySchema.js'
import {ArraySchema} from '../interfaces/ArraySchema.js'
import {AlternativesSchema} from '../interfaces/AlternativesSchema.js'
import {BinarySchema} from '../interfaces/BinarySchema.js'
import {BooleanSchema} from '../interfaces/BooleanSchema.js'
import {DateSchema} from '../interfaces/DateSchema.js'
import {FunctionSchema} from '../interfaces/FunctionSchema.js'
import {NumberSchema} from '../interfaces/NumberSchema.js'
import {ObjectSchema} from '../interfaces/ObjectSchema.js'
import {StringSchema} from '../interfaces/StringSchema.js'
import {LinkSchema} from '../interfaces/LinkSchema.js'
import {SymbolSchema} from '../interfaces/SymbolSchema.js'

export type Schema<P = any> =
    | AnySchema<P>
    | ArraySchema<P>
    | AlternativesSchema<P>
    | BinarySchema<P>
    | BooleanSchema<P>
    | DateSchema<P>
    | FunctionSchema<P>
    | NumberSchema<P>
    | ObjectSchema<P>
    | StringSchema<P>
    | LinkSchema<P>
    | SymbolSchema<P>;
