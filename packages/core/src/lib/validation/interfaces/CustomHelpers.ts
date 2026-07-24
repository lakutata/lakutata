import Joi from 'joi'
import {ExtensionBoundSchema} from '../types/ExtensionBoundSchema.js'
import {State} from './State.js'
import {ErrorReport} from './ErrorReport.js'
import {LanguageMessages} from '../types/LanguageMessages.js'

export interface CustomHelpers<V = any> {
    schema: ExtensionBoundSchema;
    state: State;
    prefs: Joi.ValidationOptions;
    original: V;
    warn: (code: string, local?: Joi.Context) => void;
    error: (code: string, local?: Joi.Context, localState?: State) => ErrorReport;
    message: (messages: LanguageMessages, local?: Joi.Context) => ErrorReport;
}
