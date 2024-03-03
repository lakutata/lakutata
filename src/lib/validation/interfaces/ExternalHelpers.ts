import {Context, ErrorReport, LanguageMessages, State, ValidationOptions} from 'joi'
import {ExtensionBoundSchema} from '../types/ExtensionBoundSchema.js'

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
