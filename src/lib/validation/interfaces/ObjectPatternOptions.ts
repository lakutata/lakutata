import {SchemaLike} from '../types/SchemaLike.js'
import {Reference} from './Reference.js'

export interface ObjectPatternOptions {
    fallthrough?: boolean;
    matches: SchemaLike | Reference;
}
