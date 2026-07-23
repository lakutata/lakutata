# Lakutata 动作模式 (Action Pattern)

**Lakutata** 是一个基于 IoC（控制反转）的通用应用框架，旨在为 TypeScript 和 Node.js 开发者提供模块化和可扩展的开发体验。在操作分发和入口点定义方面，Lakutata 提供了 **Action Pattern** 系统，通过模式匹配将请求或命令映射到控制器方法，从而实现灵活的操作调用。本文档详细解释了 Lakutata 框架中的 Action Pattern 定义、核心装饰器、模式管理机制以及使用示例。

## 1. Action Pattern 功能概述

**Action Pattern** 是 Lakutata 框架中用于定义和匹配操作模式的机制，主要用于注册和调用控制器方法的入口点。Action Pattern 允许开发者通过定义的模式将 HTTP 请求、命令行操作或服务调用映射到控制器中的特定方法，从而实现操作分发和处理。Lakutata 的 Action Pattern 系统支持多种入口类型，包括 HTTP 请求、命令行操作和服务操作，并利用模式匹配引擎实现高效的操作查找和执行。

### 1.1 Action Pattern 的核心目的
- **操作映射**：将特定的请求或命令映射到控制器内的方法，确保操作分发的准确性。
- **入口点定义**：通过装饰器定义操作入口点，支持多种入口类型（如 HTTP、CLI、服务调用）。
- **模式匹配**：利用模式匹配机制灵活处理复杂的服务操作调用。

### 1.2 与 Lakutata 的集成
Lakutata 提供了三个核心 Action 装饰器（`@HTTPAction`、`@CLIAction`、`@ServiceAction`），用于将控制器方法注册为不同类型的操作入口点。结合 `ActionPattern` 类型和 `PatternManager` 模式管理器，Lakutata 高效处理模式匹配和操作调用。此外，Action Pattern 系统与 DTO 系统集成，支持输入数据验证，确保操作的安全性和一致性。

## 2. Action Pattern 核心组件

### 2.1 ActionPattern 类型
`ActionPattern` 是一种键值对记录类型（`Record<string, any>`），可以包含任意属性，并支持泛型扩展以确保类型安全。它主要用于定义服务操作中的模式。

### 2.2 Action 装饰器
Lakutata 提供了三个 Action 装饰器，用于将控制器方法注册为特定类型的操作入口点。

#### 2.2.1 @HTTPAction
`@HTTPAction` 装饰器用于将控制器方法注册为 HTTP 请求的入口点。

- **参数**：
  - `route`：HTTP 路由路径（如 `/users`）。
  - `method` 或 `methods`：HTTP 请求方法，可以是单一方法（如 `'GET'`）或多个方法（如 `['GET', 'POST']`）。
  - `dtoConstructor`（可选）：用于验证请求数据的 DTO 类。
- **示例**：
  ```typescript
  import { HTTPAction } from '../../decorators/action/HTTPAction.js';
  import { Controller } from '../../components/entrypoint/lib/Controller.js';
  import { UserDTO } from './UserDTO.js';

  @Controller()
  export class UserController {
    @HTTPAction('/users', 'GET')
    async getUsers(): Promise<any> {
      return { message: 'List of users' };
    }

    @HTTPAction('/users', 'POST', UserDTO)
    async createUser(data: UserDTO): Promise<any> {
      return { message: 'User created', data };
    }
  }
  ```
- **说明**：`getUsers` 方法被注册为 `/users` 路径的 GET 请求入口点；`createUser` 方法被注册为 `/users` 路径的 POST 请求入口点，并使用 `UserDTO` 验证请求数据。

#### 2.2.2 @CLIAction
`@CLIAction` 装饰器用于将控制器方法注册为命令行操作的入口点。

- **参数**：
  - `command`：命令字符串（如 `user:create`）。
  - `dtoConstructor`（可选）：用于验证命令参数的 DTO 类。
- **示例**：
  ```typescript
  import { CLIAction } from '../../decorators/action/CLIAction.js';
  import { Controller } from '../../components/entrypoint/lib/Controller.js';
  import { UserDTO } from './UserDTO.js';

  @Controller()
  export class UserController {
    @CLIAction('user:create', UserDTO)
    async createUser(data: UserDTO): Promise<void> {
      console.log('Creating user:', data);
    }
  }
  ```
  - **说明**：`createUser` 方法被注册为 `user:create` 命令的入口点，并使用 `UserDTO` 验证命令参数。

#### 2.2.3 @ServiceAction
`@ServiceAction` 装饰器用于将控制器方法注册为服务操作的入口点。

- **参数**：
  - `pattern`：基于 `ActionPattern` 类型的操作模式，允许定义任意键值对模式。
  - `dtoConstructor`（可选）：用于验证操作数据的 DTO 类。
- **示例**：
  ```typescript
  import { ServiceAction } from '../../decorators/action/ServiceAction.js';
  import { Controller } from '../../components/entrypoint/lib/Controller.js';
  import { UserDTO } from './UserDTO.js';

  @Controller()
  export class UserController {
    @ServiceAction({ action: 'createUser', module: 'user' }, UserDTO)
    async createUser(data: UserDTO): Promise<any> {
      return { message: 'User created via service action', data };
    }
  }
  ```
  - **说明**：`createUser` 方法被注册为 `{ action: 'createUser', module: 'user' }` 模式的入口点，适用于服务间调用，并使用 `UserDTO` 验证数据。

### 2.3 模式管理器 (PatternManager)
`PatternManager` 是 Lakutata 中处理服务操作模式匹配的核心组件，基于 `Patrun` 库实现。

- **功能**：
  - 注册模式及其对应的对象（控制器方法）。
  - 查找与给定主题匹配的模式，支持精确匹配（通过 `exact` 参数）。
  - 列出包含部分模式的所有已注册模式。
  - 支持通配符匹配（通过 `globMatch` 选项）。
- **作用**：`PatternManager` 确保服务操作模式高效映射到控制器方法，适用于复杂的模式匹配场景。

## 3. Action Pattern 使用场景

- **HTTP 请求处理**：使用 `@HTTPAction` 装饰器，将控制器方法映射到特定的 HTTP 路由和方法，以处理 API 请求。
- **命令行工具开发**：使用 `@CLIAction` 装饰器，将控制器方法映射到命令行命令，支持命令行工具的开发。
- **服务间通信**：使用 `@ServiceAction` 装饰器和 `ActionPattern`，实现基于模式匹配的服务间操作调用，适用于微服务架构或模块化系统。
- **灵活的模式匹配**：借助 `PatternManager` 和 `Patrun` 库，支持复杂的模式匹配规则，允许开发者定义自定义模式以满足特定需求。

## 4. Action Pattern 的优势和特点

- **多入口支持**：Lakutata 的 Action Pattern 系统支持 HTTP、CLI 和服务入口类型，覆盖了广泛的应用场景。
- **高效的模式匹配**：通过 `Patrun` 库实现，`PatternManager` 能够高效进行模式匹配，特别适用于复杂的 `ServiceAction` 场景。
- **与 DTO 集成**：所有 Action 装饰器都支持指定 DTO 类来验证输入数据，确保操作的安全性和一致性。
- **声明式定义**：通过装饰器声明式定义操作入口点，使代码简洁且易于维护。

## 总结

Lakutata 的 Action Pattern 系统通过 `@HTTPAction`、`@CLIAction` 和 `@ServiceAction` 装饰器，为定义和注册操作入口点提供了灵活的机制。结合 `ActionPattern` 类型和 `PatternManager` 模式管理器，Lakutata 高效地将请求或命令映射到控制器方法，支持 HTTP 请求处理、命令行操作和服务间通信等多种场景。Action Pattern 与 DTO 系统的集成进一步确保了数据验证和安全性，增强了应用模块化和可扩展性。