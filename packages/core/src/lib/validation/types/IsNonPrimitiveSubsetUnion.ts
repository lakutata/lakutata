import {IsUnion} from './IsUnion.js'
import {IsPrimitiveSubset} from './IsPrimitiveSubset.js'

export type IsNonPrimitiveSubsetUnion<T> = true extends IsUnion<T> ? true extends IsPrimitiveSubset<T> ? false : true : false;
