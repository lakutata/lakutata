import {ExtensionBoundSchema} from '../types/ExtensionBoundSchema.js'
import {State} from './State.js'
import {ValidationOptions} from './ValidationOptions.js'
import {ErrorReport} from './ErrorReport.js'
import {LanguageMessages} from '../types/LanguageMessages.js'
import {Context} from './Context.js'

export interface ExternalHelpers<V = any> {
    schema: ExtensionBoundSchema
    linked: ExtensionBoundSchema | null
    state: State
    prefs: ValidationOptions
    original: V
    warn: (code: string, local?: Context) => void
    error: (code: string, local?: Context) => ErrorReport
    message: (messages: LanguageMessages, local?: Context) => ErrorReport
}
