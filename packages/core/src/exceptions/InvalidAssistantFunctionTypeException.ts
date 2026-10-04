import {Exception} from '../lib/foundation/Exception.js'

/**
 * Thrown when a `@Before` or `@After` decorator is applied to a member which is not a method, or gives an
 * async function to a method which is not async. Thrown when the class is defined. Its errno is
 * `E_INVALID_ASSISTANT_FUNCTION_TYPE`.
 */
export class InvalidAssistantFunctionTypeException extends Exception {
    public errno: string | number = 'E_INVALID_ASSISTANT_FUNCTION_TYPE'
}
