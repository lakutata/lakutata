/**
 * Error message templates by error code (`{'any.required': '{{#label}} is required'}`), or by language then error code
 * (`{fr: {'any.required': '{{#label}} est requis'}}`).
 */
export type LanguageMessages = Record<string, string | Record<string, string>>
