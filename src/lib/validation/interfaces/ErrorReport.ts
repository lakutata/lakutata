import {ErrorValidationOptions} from './ErrorValidationOptions.js'
import {LanguageMessages} from '../types/LanguageMessages.js'
import {State} from './State.js'
import {ExtensionFlag} from './ExtensionFlag.js'

export interface ErrorReport extends Error {
    code: string;
    flags: Record<string, ExtensionFlag>;
    path: string[];
    prefs: ErrorValidationOptions;
    messages: LanguageMessages;
    state: State;
    value: any;
    local: any;
}
