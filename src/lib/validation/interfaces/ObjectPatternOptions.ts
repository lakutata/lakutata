import {Reference} from 'joi'
import {SchemaLike} from '../types/SchemaLike.js'

export interface ObjectPatternOptions {
    fallthrough?: boolean;
    matches: SchemaLike | Reference;
}
