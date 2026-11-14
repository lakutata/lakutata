# Lakutata DTO and Validation

A **DTO** (data transfer object) is a class whose properties are declared with validation schemas. The framework uses
DTOs to validate object options (`@Configurable`), method arguments and results (`@Accept`, `@Return`) and controller
action input. `DTO` is exported by `lakutata` and the decorators by `lakutata/decorator/dto`; the framework uses its own
validation engine, with joi's API (extended with bigints and the numeric types below).

## 1. Defining a DTO

```typescript
import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

class AddressDTO extends DTO {
    @Expect(DTO.String().required())
    public city: string

    @Expect(DTO.String().pattern(/^[0-9]{5}$/).optional())
    public zip?: string
}

class CustomerDTO extends DTO {
    @Expect(DTO.String().min(2).max(50).required())
    public name: string

    @Expect(DTO.String().email().required())
    public email: string

    @Expect(DTO.Number().integer().min(0).default(0))
    public credit: number

    //A nested DTO
    @Expect(AddressDTO.required())
    public address: AddressDTO

    //An array of nested DTOs
    @Expect(DTO.Array(AddressDTO.Schema()).optional())
    public otherAddresses?: AddressDTO[]
}
```

### The schemas

Schemas are built by the static methods of `DTO`: `DTO.String()`, `DTO.Number()`, `DTO.BigInt()`, `DTO.Boolean()`,
`DTO.Date()`, `DTO.Binary()`, `DTO.Symbol()`, `DTO.Object()`, `DTO.Array()`, `DTO.Alternatives()`, `DTO.Any()`,
`DTO.Function()`, `DTO.AsyncFunction()`, `DTO.Class()`, `DTO.InstanceOf()`, `DTO.Cron()`, `DTO.Glob()`, `DTO.Ref()`,
`DTO.Link()`… They use joi's rules (`.required()`, `.optional()`, `.default()`, `.valid()`, `.min()`,
`.max()`, `.pattern()`, `.email()`, `.uri()`…).

- **Strict by default**: a value of the wrong type is rejected, not converted (the string `'5'` is not the number 5).
  Call `.strict(false)` to convert, for example for HTTP query strings and route parameters, which are always strings.
- **Numeric types**: `DTO.Number()` provides the integer types `int8`, `uint8`, `int16`, `uint16`, `int32`, `uint32`,
  `int64` and `uint64` (the 64-bit types are limited to JavaScript's safe integers), and the floating point types
  `float` (32-bit range) and `double`.
- **Validation options**: by default, validation stops at the first error (`abortEarly`) and unknown keys are removed
  (`stripUnknown`). `MyDTO.options({...})` returns a DTO's schema with other options.
- **A DTO class as a schema**: `MyDTO.Schema()` is its object schema, `MyDTO.required()` and `MyDTO.optional()` the same
  schema marked required or optional. A DTO class is accepted wherever a schema is expected (`@Accept`, `@Return`, the
  action decorators).

## 2. Validating

```typescript
import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

class CustomerDTO extends DTO {
    @Expect(DTO.String().min(2).required())
    public name: string

    @Expect(DTO.Number().integer().min(0).default(0))
    public credit: number
}

//Validated when constructed: defaults are applied and the unknown key "note" is removed;
//invalid data throws an InvalidValueException
const customer: CustomerDTO = new CustomerDTO({name: 'Ada', note: 'vip'})

//A DTO instance validates each change of its properties: an invalid change throws and is undone
customer.credit = 10

//Validated without creating an instance: returns the validated data (a plain object) or throws an InvalidValueException
const received: any = JSON.parse('{"name": "Ada"}')
const data: CustomerDTO = CustomerDTO.validate(received)
const later: CustomerDTO = await CustomerDTO.validateAsync(received)

//Checked without throwing
const valid: boolean = CustomerDTO.isValid({name: ''})

//Any value against any schema
const port: number = DTO.validate(8080, DTO.Number().port().required())
```

`validate()`, `validateAsync()`, `isValid()` and `isValidAsync()` take the value, then optionally a schema (the DTO's
own by default) and the validation options.

## 3. The decorators (`lakutata/decorator/dto`)

| Decorator | Applies to | Effect |
|---|---|---|
| `@Expect(schema)` | A DTO property | Declares the property's schema |
| `@IndexSignature(schema)` | A DTO class | Keeps the keys that have no `@Expect` schema, validating them against this schema, instead of removing them |
| `@Accept(...schemas)` | A method | Validates the arguments on each call, by position; throws `InvalidMethodAcceptException` |
| `@Return(schema)` | A method | Validates the result on each call (awaited for an async method); throws `InvalidMethodReturnException`, also when the method returns `undefined`, regardless of the schema |

`@Accept` and `@Return` pass the validated values on to the method (or to its caller), with defaults applied and unknown
keys removed. When a DTO class validates an argument or a result, the value passed on is a plain object, not an instance
of the class. A missing argument is accepted unless its schema is required (`MyDTO.required()`).

```typescript
import {Component, DTO} from 'lakutata'
import {Accept, Expect, IndexSignature, Return} from 'lakutata/decorator/dto'

class TransferDTO extends DTO {
    @Expect(DTO.String().required())
    public to: string

    @Expect(DTO.Number().positive().required())
    public amount: number
}

class UserDTO extends DTO {
    @Expect(DTO.Number().integer().required())
    public id: number

    @Expect(DTO.String().required())
    public name: string
}

//A device and its numeric readings, named freely
@IndexSignature(DTO.Number())
class ReadingsDTO extends DTO {
    [sensor: string]: any

    @Expect(DTO.String().required())
    public device: string
}

class Bank extends Component {
    //The transfer is required, the note optional
    @Accept(TransferDTO.required(), DTO.String().max(140).optional())
    public async transfer(transfer: TransferDTO, note?: string): Promise<void> {
        console.log(`${transfer.amount} to ${transfer.to}`, note)
    }

    //The password hash is removed from the result: UserDTO has no schema for it
    @Return(UserDTO)
    public async find(id: number): Promise<UserDTO> {
        return {id: id, name: 'Ada', passwordHash: '…'} as UserDTO
    }
}
```

## 4. DTOs in the framework

- **Object options**: `@Configurable(schema)` (from `lakutata/decorator/di`) validates a component or provider
  option; see [Dependency Injection](Injection.md).
- **Controller actions**: the DTO passed to `@GET`, `@POST`, `@CLIAction`, `@ServiceAction`… validates the action's
  input; invalid input results in a 400 response. See [Controllers and Actions](Controllers.md).
- **Pagination** (`lakutata/dtos`): `PaginationSearchDTO` and `PaginationResultDTO` are the input and result of
  paginated actions, and `paginator` computes the pages; `FlexibleDTO` is a DTO that accepts any key.
- **Validation messages**: error messages can be translated; `registerValidationMessages`, `runInValidationLanguage` and
  `currentValidationLanguage` (from `lakutata`) manage their languages, and the I18n component's language
  middleware sets each request's language (see [Internationalization (i18n)](I18n.md)).

## 5. JSON Schema and OpenAPI

DTOs and schemas convert to and from JSON Schema (drafts 04, 06, 07, 2019-09 and 2020-12) and OpenAPI 3.0/3.1 schema
objects, to share validation rules with front ends, publish API documents, store schemas, or generate DTOs from OpenAPI
documents.

### 5.1 Export

```typescript
import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'
import {toJsonSchema} from 'lakutata/dtos'

class UserDTO extends DTO {
    @Expect(DTO.Number().integer().required())
    public id: number

    @Expect(DTO.String().required())
    public name: string
}

UserDTO.toJsonSchema()                  //JSON Schema 2020-12 (default)
UserDTO.toJsonSchema('draft-07')        //'draft-2020-12' | 'draft-2019-09' | 'draft-07' | 'draft-04'
UserDTO.toOpenAPIJsonSchema()           //OpenAPI 3.1 (default), or '3.0'
toJsonSchema(DTO.String().email(), {target: 'openapi-3.0'})   //any schema, or a DTO class
```

- The JSON Schema describes the values the schema accepts without conversion, and ajv (with ajv-formats) and other
  validators accept those values. What JSON Schema cannot express (custom rules, references to other values,
  conversions) is left out, so the JSON Schema may also accept values the schema rejects, never the reverse.
- Unknown keys follow the validation options: with Lakutata's defaults (`allowUnknown`, `stripUnknown`), objects
  accept them; pass `preferences` to convert a schema for other options.
- The numeric types become integer bounds (`int8` to `uint64`) and float ranges; in OpenAPI they also receive the
  formats `int32`, `int64`, `float` and `double`.

### 5.2 Import

```typescript
import {readFileSync} from 'node:fs'
import {DTO, type JSONSchema} from 'lakutata'
import {fromJsonSchema} from 'lakutata/dtos'

const userJsonSchema: JSONSchema = {
    type: 'object',
    properties: {id: {type: 'integer'}, name: {type: 'string'}},
    required: ['id']
}

//A schema
const schema = fromJsonSchema(userJsonSchema)
DTO.validate({id: 1}, schema)

//A DTO class, a subclass of the class on which fromJsonSchema() is called
const UserDTO = DTO.fromJsonSchema(userJsonSchema)
const user = new UserDTO({id: 1, name: 'Alice'})

//The DTO classes of the object schemas of an OpenAPI document (components.schemas), by name
const openApiDocument: Record<string, unknown> = JSON.parse(readFileSync('openapi.json', 'utf8'))
const {Pet, Person} = DTO.fromOpenAPI(openApiDocument)
```

- Imported schemas validate as JSON Schema does: values are not converted (unless `convert: true` is specified), unknown
  keys follow `additionalProperties`, formats are checked as ajv-formats checks them, and defaults are applied.
- References are resolved by JSON pointer, `$anchor` and `$id` (pass other documents in `schemas`, and an OpenAPI
  document in `document`); recursive references are supported.
- The version is read from `$schema`, or specified with `dialect` (default: 2020-12).
- Converting a Lakutata schema to JSON Schema loses information (custom rules, conversions): to store a schema and
  restore it exactly, keep its `describe()` output (a JSON value unless it contains functions) and rebuild it with
  `DTO.Build(description)`.
