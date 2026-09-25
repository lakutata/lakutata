import {Exception} from '../lib/foundation/Exception.js'

export class InvalidAssistantFunctionTypeException extends Exception {
    public errno: string | number = 'E_INVALID_ASSISTANT_FUNCTION_TYPE'
}
