import {type AnySchema} from '../interfaces/AnySchema.js'
import {type ArraySchema} from '../interfaces/ArraySchema.js'
import {type AlternativesSchema} from '../interfaces/AlternativesSchema.js'
import {type BinarySchema} from '../interfaces/BinarySchema.js'
import {type BooleanSchema} from '../interfaces/BooleanSchema.js'
import {type DateSchema} from '../interfaces/DateSchema.js'
import {type FunctionSchema} from '../interfaces/FunctionSchema.js'
import {type NumberSchema} from '../interfaces/NumberSchema.js'
import {type ObjectSchema} from '../interfaces/ObjectSchema.js'
import {type StringSchema} from '../interfaces/StringSchema.js'
import {type LinkSchema} from '../interfaces/LinkSchema.js'
import {type SymbolSchema} from '../interfaces/SymbolSchema.js'

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
