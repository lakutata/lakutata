import {Context, ErrorReport, LanguageMessages, State, ValidationOptions} from 'joi'
import {ExtensionBoundSchema} from '../types/ExtensionBoundSchema.js'

export interface CustomHelpers<V = any> {
    schema: ExtensionBoundSchema;
    state: State;
    prefs: ValidationOptions;
    original: V;
    warn: (code: string, local?: Context) => void;
    error: (code: string, local?: Context, localState?: State) => ErrorReport;
    message: (messages: LanguageMessages, local?: Context) => ErrorReport;
}
