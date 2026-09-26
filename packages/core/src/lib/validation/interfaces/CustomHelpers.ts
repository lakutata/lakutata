import {ExtensionBoundSchema} from '../types/ExtensionBoundSchema.js'
import {State} from './State.js'
import {ErrorReport} from './ErrorReport.js'
import {LanguageMessages} from '../types/LanguageMessages.js'
import {Context} from './Context.js'
import {ValidationOptions} from './ValidationOptions.js'

export interface CustomHelpers<V = any> {
    schema: ExtensionBoundSchema;
    state: State;
    prefs: ValidationOptions;
    original: V;
    warn: (code: string, local?: Context) => void;
    error: (code: string, local?: Context, localState?: State) => ErrorReport;
    message: (messages: LanguageMessages, local?: Context) => ErrorReport;
}
