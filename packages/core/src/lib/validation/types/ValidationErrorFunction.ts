import {ErrorReport} from '../interfaces/ErrorReport.js'
import {ValidationErrorItem} from '../interfaces/ValidationErrorItem.js'

export type ValidationErrorFunction = (errors: ErrorReport[]) => string | ValidationErrorItem | Error | ErrorReport[]
