## Description

Validator is a validation class used in the Lakutata framework. It is based on Joi and provides additional validation
functionalities. The framework's method input values and return values can be validated using the Validator decorator.

## Validation Methods

#### `Any`

Arbitrary type validation

- Returns: `AnySchema<TSchema>` - Arbitrary type validator

#### `String`

String type validation

- Returns: `StringSchema<TSchema>` - String type validator

#### `Number`

Number type validation

- Returns: `NumberSchema<TSchema>` - Number type validator

#### `Boolean`

Boolean type validation

- Returns: `BooleanSchema<TSchema>` - Boolean type validator

#### `Date`

Date type validation

- Returns: `DateSchema<TSchema>` - Date type validator

#### `Object`

Object type validation

- `schema?`: `SchemaMap<T, isStrict>` - Object validation schema
- Returns: `ObjectSchema<TSchema>` - Object type validator

#### `Array`

Array type validation

- `...types`: `SchemaLikeWithoutArray[]` - Array element type validator
- Returns: `ArraySchema<TSchema>` - Array type validator

#### `Binary`

Binary type validation

- Returns: `BinarySchema<TSchema>` - Binary type validator

#### `Function`

Function type validation

- Returns: `FunctionSchema<TSchema>` - Function type validator

#### `AsyncFunction`

Asynchronous function type validation

- Returns: `FunctionSchema<TSchema>` - Asynchronous function type validator

#### `Class`

Class type validation

- `inheritsFrom?`: `TSchema | (() => TSchema)` - The target class inherits from the following class
- Returns: `FunctionSchema<TSchema>` - Class type validator

#### `Glob`

Wildcard matching operator string validation

- Returns: `StringSchema<TSchema>` - Wildcard matching operator string validator

#### `Cron`

Cron expression validation

- `options?`: `{ alias?: boolean; seconds?: boolean; allowBlankDay?: boolean; allowSevenAsSunday?: boolean }` - 可选的配置对象
- Returns: `StringSchema<TSchema>` - Cron expression validator

#### `HttpDocument`

Validation of Document type data in an HTTP request

- Returns: `StringSchema<TSchema>` - String type validator

#### `Symbol`

Symbol type validation

- Returns: `SymbolSchema<TSchema>` - Symbol type validator

#### `Alternatives`

Optional parameter type validation

- `...types`: `SchemaLike[]` - Validator for optional parameters
- Returns: `AlternativesSchema<TSchema>` - Optional parameter type validator

#### `Ref`

Generate a reference for a named key-value

- `key`: `string` - Referenced key name
- `options?`: `ReferenceOptions` - Reference options
- Returns: `Reference` - Referenced object

#### `Forbidden`

Mark a key as forbidden, which means that the key will not allow any value except for `undefined`

- Returns: `Schema` - Forbidden validator

#### `In`

Create a reference that, when resolved, is used as an array of values to match against the rules

- `ref`: `string` - Referenced key name
- `options?`: `ReferenceOptions` - Reference options
- Returns: `Reference` - Referenced object

#### `Attempt`

Perform pattern validation on a value, returning a valid object. If the validation fails, an exception is thrown

- `value`: `any` - Value to be validated
- `schema`: `Schema` - Validator schema
- `options?`: `ValidationOptions` - Validation options
- Returns: `TSchema extends Schema<infer Value> ? Value : never` - Validated value

#### `isValid`

Determine if the data is correct based on the schema (synchronous method)

- `data`: `T` - Value to be validated
- `schema`: `Schema` - Validator schema
- `options?`: `ValidationOptions` - Validation options
- Returns: `boolean` - Whether the data is correct or not

#### `isValidAsync`

Determine if the data is correct based on the schema (asynchronous method)

- `data`: `T` - Value to be validated
- `schema`: `Schema` - Validator schema
- `options?`: `ValidationOptions` - Validation options
- Returns: `Promise<boolean>` - Promise indicating whether the data is correct or not

#### `validate`

Validate the data based on the schema (synchronous method)

- `data`: `T` - Value to be validated
- `schema`: `Schema` - Validator schema
- `options?`: `ValidationOptions` - Validation options
- Returns: `T` - Validated value

#### `validateAsync`

Validate the data based on the schema (asynchronous method)

- `data`: `T` - Value to be validated
- `schema`: `Schema` - Validator schema
- `options?`: `ValidationOptions` - Validation options
- Returns: `Promise<T>` - Promise containing the validated data
