# Lakutata DTO and Validation

A **DTO** (data transfer object) is a class whose properties are declared with validation schemas. The framework
validates with them the options of the objects (`@Configurable`), the arguments and results of methods (`@Accept`,
`@Return`) and the inputs of the controller actions. `DTO` is exported by `lakutata`, the decorators by
`lakutata/decorator/dto`; the validation engine is the framework's own, with the API of joi (extended with bigints and
the numeric types below).

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

The schemas are built by the static methods of `DTO`: `DTO.String()`, `DTO.Number()`, `DTO.BigInt()`, `DTO.Boolean()`,
`DTO.Date()`, `DTO.Binary()`, `DTO.Symbol()`, `DTO.Object()`, `DTO.Array()`, `DTO.Alternatives()`, `DTO.Any()`,
`DTO.Function()`, `DTO.AsyncFunction()`, `DTO.Class()`, `DTO.InstanceOf()`, `DTO.Cron()`, `DTO.Glob()`, `DTO.Ref()`,
`DTO.Link()`… Their rules are the ones of joi (`.required()`, `.optional()`, `.default()`, `.valid()`, `.min()`,
`.max()`, `.pattern()`, `.email()`, `.uri()`…).

- **Strict by default**: a value of the wrong type is rejected, not converted (the string `'5'` is not the number 5).
  Call `.strict(false)` to convert, as for the query strings and route parameters of HTTP, which are always strings.
- **Numeric types**: `DTO.Number()` provides the integer types `int8`, `uint8`, `int16`, `uint16`, `int32`, `uint32`,
  `int64` and `uint64` (the 64-bit types limited to the safe integers of JavaScript), and the floating point types
  `float` (32-bit range) and `double`.
- **Validation options**: by default the validation stops at the first error (`abortEarly`), and the unknown keys are
  removed (`stripUnknown`). `MyDTO.options({...})` gives other options for a DTO used as a schema.
- **A DTO class as a schema**: `MyDTO.Schema()` is its object schema, `MyDTO.required()` and `MyDTO.optional()` the same
  schema marked required or optional. A DTO class is accepted wherever a schema is expected (`@Accept`, `@Return`, the
  action decorators).

## 2. Validating

```typescript
//Validated when constructed: the defaults applied, the unknown key "note" removed;
//an InvalidValueException is thrown when the data is invalid
const customer: CustomerDTO = new CustomerDTO({name: 'Ada', email: 'ada@example.com', address: {city: 'London'}, note: 'vip'})

//A DTO instance validates each change of its properties: an invalid change throws and is undone
customer.credit = 10

//Validated without an instance: the validated value, or an InvalidValueException
const data: CustomerDTO = CustomerDTO.validate({name: 'Ada', email: 'ada@example.com', address: {city: 'London'}})
const later: CustomerDTO = await CustomerDTO.validateAsync({name: 'Ada', email: 'ada@example.com', address: {city: 'London'}})

//Checked without exception
const valid: boolean = CustomerDTO.isValid({name: ''})

//Any value against any schema
const port: number = DTO.validate(8080, DTO.Number().port().required())
```

`validate()`, `validateAsync()`, `isValid()` and `isValidAsync()` take the value, then optionally a schema (the DTO's
own by default) and the validation options.

## 3. The decorators (`lakutata/decorator/dto`)

| Decorator | Applies to | Effect |
|---|---|---|
| `@Expect(schema)` | A property of a DTO | Declares the schema of the property |
| `@IndexSignature(schema)` | A DTO class | Keeps the keys without `@Expect` schema, validated against the schema, instead of removing them |
| `@Accept(...schemas)` | A method | Validates the arguments of each call, by position; throws `InvalidMethodAcceptException` |
| `@Return(schema)` | A method | Validates the result of each call (awaited for an async method); throws `InvalidMethodReturnException` |

`@Accept` and `@Return` give the method (or its caller) the validated values: defaults applied, unknown keys removed.
A DTO class validates an argument or a result against its schema, and the value given is a plain object, not an
instance of the class. A missing argument is accepted unless its schema is required (`MyDTO.required()`).

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

- **Object options**: `@Configurable(schema)` (from `lakutata/decorator/di`) validates an option of a component or a
  provider; see [Core](Core.md).
- **Controller actions**: the DTO given to `@GET`, `@POST`, `@CLIAction`, `@ServiceAction`… validates the input of the
  action; an invalid input is answered with the status 400. See [ActionPattern](ActionPattern.md).
- **Pagination** (`lakutata/dtos`): `PaginationSearchDTO` and `PaginationResultDTO` are the input and the result of the
  paginated actions, `paginator` computes the pages; `FlexibleDTO` is a DTO accepting any key.
- **Validation messages**: the messages of the errors are translated; `registerValidationMessages`,
  `runInValidationLanguage` and `currentValidationLanguage` (from `lakutata`) manage their languages, and the language
  middleware of the I18n component sets the language of each request (see [I18n](I18n.md)).

## 5. JSON Schema and OpenAPI

DTOs and schemas convert to and from JSON Schema (drafts 04, 06, 07, 2019-09 and 2020-12) and OpenAPI 3.0/3.1 schema
objects, to share validation rules with front ends, publish API documents, store schemas, or generate DTOs from OpenAPI
documents.

### 5.1 Export

```typescript
import {DTO} from 'lakutata'
import {toJsonSchema} from 'lakutata/dtos'

UserDTO.toJsonSchema()                  //JSON Schema 2020-12 (default)
UserDTO.toJsonSchema('draft-07')        //'draft-2020-12' | 'draft-2019-09' | 'draft-07' | 'draft-04'
UserDTO.toOpenAPIJsonSchema()           //OpenAPI 3.1 (default), or '3.0'
toJsonSchema(DTO.String().email(), {target: 'openapi-3.0'})   //any schema, or a DTO class
```

- The JSON Schema describes the values the schema accepts without conversion, so ajv (with ajv-formats) and other
  validators accept exactly these values; what JSON Schema cannot express (custom rules, references to other values,
  conversions) is dropped, so the JSON Schema may accept more values, never fewer.
- The unknown keys follow the validation options: with the defaults of lakutata (`allowUnknown`, `stripUnknown`) the
  objects accept them; pass `preferences` to convert for other options.
- The numeric types convert to integer bounds (`int8` to `uint64`) and float ranges; OpenAPI also names the formats
  `int32`, `int64`, `float` and `double`.

### 5.2 Import

```typescript
import {DTO} from 'lakutata'
import {fromJsonSchema} from 'lakutata/dtos'

const schema = fromJsonSchema({type: 'object', properties: {id: {type: 'integer'}}, required: ['id']})
DTO.validate({id: 1}, schema)

//A DTO class, a subclass of the class it is created from
const UserDTO = DTO.fromJsonSchema(userJsonSchema)
const user = new UserDTO({id: 1, name: 'Alice'})

//The DTO classes of the object schemas of an OpenAPI document (components.schemas), by name
const {Pet, Person} = DTO.fromOpenAPI(openApiDocument)
```

- The imported schemas validate like JSON Schema: the values are not converted (`convert: true` converts them), the
  unknown keys follow `additionalProperties`, the formats validate like ajv-formats, and the defaults are applied.
- The references resolve by JSON pointer, `$anchor` and `$id` (pass other documents with `schemas`, an OpenAPI document
  with `document`); recursive references are supported.
- The version is read from `$schema`, or given with `dialect` (default: 2020-12).
- JSON Schema is lossy for the schemas of lakutata (custom rules, conversions): to store a schema and restore it
  exactly, keep its `describe()` output (a JSON value unless it holds functions) and rebuild it with
  `DTO.Build(description)`.
