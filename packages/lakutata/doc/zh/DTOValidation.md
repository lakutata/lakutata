# Lakutata DTO 与数据校验

**DTO**（数据传输对象）是用校验规则声明属性的类。框架用它们校验对象的选项（`@Configurable`）、方法的参数和返回值（`@Accept`、`@Return`）以及控制器动作的输入。`DTO` 由 `lakutata` 导出，相关装饰器由 `lakutata/decorator/dto` 导出；校验引擎是框架自带的，API 与 joi 相同（并扩展了 bigint 和下文的数值类型）。

## 1. 定义 DTO

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

    //嵌套的 DTO
    @Expect(AddressDTO.required())
    public address: AddressDTO

    //嵌套 DTO 的数组
    @Expect(DTO.Array(AddressDTO.Schema()).optional())
    public otherAddresses?: AddressDTO[]
}
```

### 校验规则

校验规则由 `DTO` 的静态方法构建：`DTO.String()`、`DTO.Number()`、`DTO.BigInt()`、`DTO.Boolean()`、`DTO.Date()`、`DTO.Binary()`、`DTO.Symbol()`、`DTO.Object()`、`DTO.Array()`、`DTO.Alternatives()`、`DTO.Any()`、`DTO.Function()`、`DTO.AsyncFunction()`、`DTO.Class()`、`DTO.InstanceOf()`、`DTO.Cron()`、`DTO.Glob()`、`DTO.Ref()`、`DTO.Link()` 等。规则方法与 joi 相同（`.required()`、`.optional()`、`.default()`、`.valid()`、`.min()`、`.max()`、`.pattern()`、`.email()`、`.uri()` 等）。

- **默认严格**：类型不对的值会被拒绝，而不是被转换（字符串 `'5'` 不是数字 5）。需要转换时调用 `.strict(false)`，例如 HTTP 的查询参数和路由参数总是字符串。
- **数值类型**：`DTO.Number()` 提供整数类型 `int8`、`uint8`、`int16`、`uint16`、`int32`、`uint32`、`int64` 和 `uint64`（64 位类型限于 JavaScript 的安全整数范围），以及浮点类型 `float`（32 位范围）和 `double`。
- **校验选项**：默认在遇到第一个错误时停止（`abortEarly`），并移除未知字段（`stripUnknown`）。DTO 作为校验规则使用时，可用 `MyDTO.options({...})` 指定其他选项。
- **DTO 类作为校验规则**：`MyDTO.Schema()` 是它的对象校验规则，`MyDTO.required()` 和 `MyDTO.optional()` 是标记为必填或可选的同一规则。凡是需要校验规则的地方（`@Accept`、`@Return`、动作装饰器）都可以直接使用 DTO 类。

## 2. 校验

```typescript
//构造时校验：填充默认值，移除未知字段 "note"；数据不合法时抛出 InvalidValueException
const customer: CustomerDTO = new CustomerDTO({name: 'Ada', email: 'ada@example.com', address: {city: 'London'}, note: 'vip'})

//DTO 实例会校验对其属性的每次修改：不合法的修改会抛出异常并被撤销
customer.credit = 10

//不创建实例直接校验：返回校验后的值，或抛出 InvalidValueException
const data: CustomerDTO = CustomerDTO.validate({name: 'Ada', email: 'ada@example.com', address: {city: 'London'}})
const later: CustomerDTO = await CustomerDTO.validateAsync({name: 'Ada', email: 'ada@example.com', address: {city: 'London'}})

//只检查，不抛出异常
const valid: boolean = CustomerDTO.isValid({name: ''})

//用任意校验规则校验任意值
const port: number = DTO.validate(8080, DTO.Number().port().required())
```

`validate()`、`validateAsync()`、`isValid()` 和 `isValidAsync()` 的参数依次为：要校验的值，可选的校验规则（默认为该 DTO 自身的规则），以及校验选项。

## 3. 装饰器（`lakutata/decorator/dto`）

| 装饰器 | 作用对象 | 效果 |
|---|---|---|
| `@Expect(schema)` | DTO 的属性 | 声明属性的校验规则 |
| `@IndexSignature(schema)` | DTO 类 | 保留没有 `@Expect` 规则的字段并按该规则校验，而不是移除它们 |
| `@Accept(...schemas)` | 方法 | 每次调用时按位置校验参数；失败时抛出 `InvalidMethodAcceptException` |
| `@Return(schema)` | 方法 | 每次调用时校验返回值（异步方法会等待其结果）；失败时抛出 `InvalidMethodReturnException` |

`@Accept` 和 `@Return` 把校验后的值交给方法（或调用方）：已填充默认值、已移除未知字段。用 DTO 类校验参数或返回值时，得到的是普通对象，而不是该类的实例。缺少的参数会被接受，除非它的规则是必填的（`MyDTO.required()`）。

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

//设备及其读数，读数名称可以任意取
@IndexSignature(DTO.Number())
class ReadingsDTO extends DTO {
    [sensor: string]: any

    @Expect(DTO.String().required())
    public device: string
}

class Bank extends Component {
    //转账参数必填，备注可选
    @Accept(TransferDTO.required(), DTO.String().max(140).optional())
    public async transfer(transfer: TransferDTO, note?: string): Promise<void> {
        console.log(`${transfer.amount} to ${transfer.to}`, note)
    }

    //结果中的密码哈希会被移除：UserDTO 没有为它声明规则
    @Return(UserDTO)
    public async find(id: number): Promise<UserDTO> {
        return {id: id, name: 'Ada', passwordHash: '…'} as UserDTO
    }
}
```

## 4. 框架中的 DTO

- **对象选项**：`@Configurable(schema)`（来自 `lakutata/decorator/di`）校验组件、提供者或模块的选项；见 [Core](Core.md)。
- **控制器动作**：传给 `@GET`、`@POST`、`@CLIAction`、`@ServiceAction` 等的 DTO 校验动作的输入；输入不合法时以状态码 400 响应。见 [ActionPattern](ActionPattern.md)。
- **分页**（`lakutata/dtos`）：`PaginationSearchDTO` 和 `PaginationResultDTO` 是分页动作的输入和结果，`paginator` 负责计算分页；`FlexibleDTO` 是接受任意字段的 DTO。
- **校验消息**：错误消息支持多语言；`lakutata` 中的 `registerValidationMessages`、`runInValidationLanguage` 和 `currentValidationLanguage` 管理其语言，I18n 组件的语言中间件为每个请求设置语言（见 [I18n](I18n.md)）。

## 5. JSON Schema 与 OpenAPI

DTO 和校验规则可以与 JSON Schema（draft 04、06、07、2019-09 和 2020-12）以及 OpenAPI 3.0/3.1 的 schema 对象互相转换，用于与前端共享校验规则、发布 API 文档、存储校验规则，或从 OpenAPI 文档生成 DTO。

### 5.1 导出

```typescript
import {DTO} from 'lakutata'
import {toJsonSchema} from 'lakutata/dtos'

UserDTO.toJsonSchema()                  //JSON Schema 2020-12（默认）
UserDTO.toJsonSchema('draft-07')        //'draft-2020-12' | 'draft-2019-09' | 'draft-07' | 'draft-04'
UserDTO.toOpenAPIJsonSchema()           //OpenAPI 3.1（默认），或 '3.0'
toJsonSchema(DTO.String().email(), {target: 'openapi-3.0'})   //任意校验规则，或 DTO 类
```

- 生成的 JSON Schema 描述的是校验规则在不做转换时接受的值，因此 ajv（配合 ajv-formats）等校验器接受的值与之完全一致；JSON Schema 无法表达的内容（自定义规则、对其他值的引用、类型转换）会被丢弃，所以 JSON Schema 接受的值只会更多，不会更少。
- 未知字段遵循校验选项：在 lakutata 的默认选项（`allowUnknown`、`stripUnknown`）下，对象接受未知字段；使用其他选项时通过 `preferences` 传入。
- 数值类型转换为整数边界（`int8` 到 `uint64`）和浮点范围；OpenAPI 还会给出 `int32`、`int64`、`float` 和 `double` 格式名。

### 5.2 导入

```typescript
import {DTO} from 'lakutata'
import {fromJsonSchema} from 'lakutata/dtos'

const schema = fromJsonSchema({type: 'object', properties: {id: {type: 'integer'}}, required: ['id']})
DTO.validate({id: 1}, schema)

//生成 DTO 类，它是调用该方法的类的子类
const UserDTO = DTO.fromJsonSchema(userJsonSchema)
const user = new UserDTO({id: 1, name: 'Alice'})

//OpenAPI 文档中各对象 schema（components.schemas）对应的 DTO 类，按名称取用
const {Pet, Person} = DTO.fromOpenAPI(openApiDocument)
```

- 导入的校验规则按 JSON Schema 的语义校验：不转换值（`convert: true` 时转换），未知字段遵循 `additionalProperties`，格式校验与 ajv-formats 一致，并会填充默认值。
- 引用通过 JSON pointer、`$anchor` 和 `$id` 解析（其他文档通过 `schemas` 传入，OpenAPI 文档通过 `document` 传入）；支持递归引用。
- 版本从 `$schema` 读取，或通过 `dialect` 指定（默认 2020-12）。
- 对 lakutata 的校验规则而言，JSON Schema 会丢失信息（自定义规则、类型转换）：要原样存储并恢复校验规则，请保存它的 `describe()` 输出（不含函数时是一个 JSON 值），再用 `DTO.Build(description)` 重建。
