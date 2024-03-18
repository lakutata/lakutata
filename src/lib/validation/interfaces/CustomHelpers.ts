import {type Context, type ErrorReport, type LanguageMessages, type State, type ValidationOptions} from 'joi'
import {type ExtensionBoundSchema} from '../types/ExtensionBoundSchema.js'

export interface CustomHelpers<V = any> {
    schema: ExtensionBoundSchema;
    state: State;
    prefs: ValidationOptions;
    original: V;
    warn: (code: string, local?: Context) => void;
    error: (code: string, local?: Context, localState?: State) => ErrorReport;
    message: (messages: LanguageMessages, local?: Context) => ErrorReport;
}
