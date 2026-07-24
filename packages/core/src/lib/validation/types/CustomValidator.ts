import {CustomHelpers} from '../interfaces/CustomHelpers.js'
import {ErrorReport} from '../interfaces/ErrorReport.js'

export type CustomValidator<V = any, R = V> = (value: V, helpers: CustomHelpers<R>) => R | ErrorReport;
