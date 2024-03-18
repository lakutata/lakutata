import {type Context, type ErrorReport, type LanguageMessages, type State, type ValidationOptions} from 'joi'
import {type ExtensionBoundSchema} from '../types/ExtensionBoundSchema.js'

export interface ExternalHelpers<V = any> {
    schema: ExtensionBoundSchema;
    linked: ExtensionBoundSchema | null;
    state: State;
    prefs: ValidationOptions;
    original: V;
    warn: (code: string, local?: Context) => void;
    error: (code: string, local?: Context) => ErrorReport;
    message: (messages: LanguageMessages, local?: Context) => ErrorReport;
}
