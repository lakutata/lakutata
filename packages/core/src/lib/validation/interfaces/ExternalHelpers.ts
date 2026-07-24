import Joi from 'joi'
import {ExtensionBoundSchema} from '../types/ExtensionBoundSchema.js'
import {State} from './State.js'
import {ValidationOptions} from './ValidationOptions.js'
import {ErrorReport} from './ErrorReport.js'
import {LanguageMessages} from '../types/LanguageMessages.js'

export interface ExternalHelpers<V = any> {
    schema: ExtensionBoundSchema;
    linked: ExtensionBoundSchema | null;
    state: State;
    prefs: ValidationOptions;
    original: V;
    warn: (code: string, local?: Joi.Context) => void;
    error: (code: string, local?: Joi.Context) => ErrorReport;
    message: (messages: LanguageMessages, local?: Joi.Context) => ErrorReport;
}
