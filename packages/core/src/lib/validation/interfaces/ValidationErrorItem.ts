import {Context} from './Context.js'

export interface ValidationErrorItem {
    message: string
    path: Array<string | number>
    type: string
    context?: Context
}
