import {SchemaException} from './SchemaException.js'

/**
 * An invalid schema definition: invalid rule arguments, options, templates, references or key dependencies
 */
export class SchemaDefinitionException extends SchemaException {
    public errno: string | number = 'E_SCHEMA_DEFINITION'
}
