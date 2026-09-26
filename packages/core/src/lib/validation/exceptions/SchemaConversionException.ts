import {SchemaException} from './SchemaException.js'

/**
 * A schema which cannot be converted (to a JSON schema or an OpenAPI schema object)
 */
export class SchemaConversionException extends SchemaException {
    public errno: string | number = 'E_SCHEMA_CONVERSION'
}
