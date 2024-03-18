import {ErrorReport} from 'joi'
import {CustomHelpers} from '../interfaces/CustomHelpers.js'

export type CustomValidator<V = any, R = V> = (value: V, helpers: CustomHelpers<R>) => R | ErrorReport;
