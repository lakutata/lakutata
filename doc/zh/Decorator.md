# Lakutata 装饰器

**Lakutata** 是一个基于 IoC（控制反转）的通用应用框架，广泛使用装饰器来实现元编程。这简化了依赖注入、控制器行为定义、数据模型管理等操作。本文档详细解释了 Lakutata 框架及其集成中使用的各种装饰器，包括 Lakutata 的自定义装饰器和集成的 TypeORM 装饰器。

## 1. 概述

在 Lakutata 中，装饰器是 TypeScript 的核心功能，用于将元数据或行为附加到类、方法或属性上。Lakutata 利用装饰器来实现依赖注入、控制器路由、数据验证以及与 TypeORM 等数据库 ORM 的集成。装饰器分为以下几类：
- **依赖注入装饰器**：用于管理依赖和配置注入。
- **控制器行为装饰器**：用于定义 HTTP、CLI 和服务入口点的行为。
- **DTO 验证装饰器**：用于验证数据传输对象的属性。
- **数据库模型装饰器**：与 TypeORM 集成，用于定义实体、列、关系和其他数据库结构。

以下章节将详细阐述每个装饰器类别的功能和用法。

## 2. 依赖注入装饰器

依赖注入（DI）是 Lakutata 的核心机制，相关装饰器用于声明和管理组件、控制器或提供者之间的依赖关系。

### 2.1 `@Inject()`
- **功能**：声明某个属性或参数需要通过 IoC 容器进行依赖注入。支持按类型或特定名称注入。
- **使用场景**：将服务、日志记录器或其他依赖注入到组件、控制器或提供者中。
- **参数**：可选参数，用于指定注入对象的名称或类型（如 `Application`）。
- **示例**：
  ```typescript
  import { Component } from '../../lib/core/Component.js';
  import { Inject } from '../../decorators/di/Inject.js';
  import type { Logger } from '../../components/Logger.js';
  import { Application } from '../../lib/core/Application.js';

  export class TestComponent extends Component {
    @Inject()
    protected readonly log: Logger;

    @Inject(Application)
    protected readonly app: Application;

    protected async init(): Promise<void> {
      this.log.info('TestComponent initialized');
    }
  }
  ```
- **说明**：在上述示例中，`log` 属性通过类型推断注入了一个 `Logger` 实例，而 `app` 属性明确指定注入 `Application` 实例。

### 2.2 `@Configurable()`
- **功能**：将配置值注入到属性中，通常用于提供者或组件中从配置对象获取值。
- **使用场景**：动态注入外部配置参数（如路径、密钥）。
- **参数**：无，通常直接应用于属性。
- **示例**：
  ```typescript
  import { Provider } from '../../lib/core/Provider.js';
  import { Configurable } from '../../decorators/di/Configurable.js';

  export class TestProvider extends Provider {
    @Configurable()
    protected readonly path: string;

    protected async init(): Promise<void> {
      console.log('TestProviderInit', this.path);
    }
  }
  ```
- **说明**：`path` 属性从应用配置中获取值，该配置在 `Application.run()` 中定义（如通过 `path` 字段）。

### 2.3 `@Transient()`
- **功能**：定义类的生命周期为瞬态，即每次请求该对象时都会创建一个新实例。
- **使用场景**：适用于需要独立状态或资源的场景，避免单例模式下的共享状态。
- **参数**：无，通常在类级别应用。
- **示例**：
  ```typescript
  import { Provider } from '../../lib/core/Provider.js';
  import { Transient } from '../../decorators/di/Lifetime.js';

  @Transient()
  export class TestProvider extends Provider {
    protected async init(): Promise<void> {
      console.log('New instance created');
    }
  }
  ```
- **说明**：每次请求 `TestProvider` 时，IoC 容器都会返回一个新实例，而不是共享的单例。

## 3. 控制器行为装饰器

Lakutata 中的控制器（`Controller`）使用装饰器来定义处理 HTTP 请求、CLI 命令或服务消息的行为。这些装饰器指定路由、命令或消息模式。

### 3.1 `@HTTPAction(route: string, methods: string | string[], dto?: DTO)`
- **功能**：定义控制器方法以处理特定的 HTTP 请求路由和方法（如 GET、POST）。
- **使用场景**：在 HTTP 入口点中定义 API 端点。
- **参数**：
  - `route`：路由路径，支持参数化（如 `/test/:id`）。
  - `methods`：支持的 HTTP 方法，可以是单个字符串（如 `'GET'`）或数组（如 `['GET', 'POST']`）。
  - `dto`：可选参数，指定用于输入数据验证的数据传输对象（DTO）类。
- **示例**：
  ```typescript
  import { Controller } from '../../components/entrypoint/lib/Controller.js';
  import { HTTPAction } from '../../decorators/ctrl/HTTPAction.js';
  import { DTO } from '../../lib/core/DTO.js';

  class TestDTO extends DTO {
    // DTO 定义省略
  }

  export class TestController1 extends Controller {
    @HTTPAction('/test', 'GET')
    public async test(inp) {
      return 'oh!';
    }

    @HTTPAction('/test/:id', ['GET', 'POST'], TestDTO)
    public async test3(inp) {
      return 'oh!!!!!!!!!!';
    }
  }
  ```
- **说明**：`test` 方法处理 `/test` 路径的 GET 请求，而 `test3` 方法处理 `/test/:id` 的 GET 和 POST 请求，并使用 `TestDTO` 进行输入验证。

### 3.2 `@CLIAction(command: string, dto?: DTO)`
- **功能**：定义控制器方法以处理特定的 CLI 命令。
- **使用场景**：在 CLI 入口点中定义命令行操作。
- **参数**：
  - `command`：命令名称。
  - `dto`：可选参数，指定用于验证命令参数的 DTO 类。
- **示例**：
  ```typescript
  import { Controller } from '../../components/entrypoint/lib/Controller.js';
  import { CLIAction } from '../../decorators/ctrl/CLIAction.js';
  import { DTO } from '../../lib/core/DTO.js';

  class TestDTO extends DTO {
    // DTO 定义省略
  }

  export class TestController1 extends Controller {
    @CLIAction('test3', TestDTO)
    public async test3(inp) {
      console.log('cli!');
      return 'oh!!!!!!!!!!';
    }
  }
  ```
- **说明**：`test3` 方法处理 `test3` 命令，并使用 `TestDTO` 验证输入参数。

### 3.3 `@ServiceAction(pattern: object)`
- **功能**：定义控制器方法以处理特定的服务消息模式。
- **使用场景**：在服务入口点中处理实时消息或其他服务请求。
- **参数**：
  - `pattern`：用于匹配服务请求的消息模式对象。
- **示例**：
  ```typescript
  import { Controller } from '../../components/entrypoint/lib/Controller.js';
  import { ServiceAction } from '../../decorators/ctrl/ServiceAction.js';

  export class TestController1 extends Controller {
    @ServiceAction({
      act: 'test3',
      bbc: { abc: true, ccc: 1 }
    })
    public async test3(inp) {
      return 'oh!!!!!!!!!!';
    }
  }
  ```
- **说明**：`test3` 方法处理与指定模式匹配的服务请求。

## 4. DTO 验证装饰器

数据传输对象（DTO）用于验证输入数据，Lakutata 提供装饰器来定义 DTO 属性的验证规则。

### 4.1 `@Expect(rule: DTO.Rule)`
- **功能**：为 DTO 属性定义验证规则，如是否必填或有类型约束。
- **使用场景**：在 DTO 类中验证 HTTP 请求或 CLI 命令的输入数据。
- **参数**：
  - `rule`：验证规则对象，通常使用 `DTO.String()`、`DTO.Number()` 等方法构建。
- **示例**：
  ```typescript
  import { DTO } from '../../lib/core/DTO.js';
  import { Expect } from '../../decorators/dto/Expect.js';

  class TestDTO extends DTO {
    @Expect(DTO.String().optional())
    public aaa: string;

    @Expect(DTO.Number().required().strict(false).description('hahahaha'))
    public bbb: number;
  }
  ```
- **说明**：`aaa` 属性是一个可选的字符串，而 `bbb` 属性是一个必填的数字，并附带描述信息。

## 5. 数据库模型装饰器（TypeORM 集成）

Lakutata 与 TypeORM 集成用于数据库操作，提供了众多装饰器来定义实体、列、关系等。这些装饰器直接引用自 TypeORM 库，Lakutata 通过导出提供了便捷的访问方式。

### 5.1 实体相关装饰器
- **`@Entity()`**：将类标记为数据库实体，映射到数据库表。
- **`@ViewEntity()`**：将类标记为视图实体，映射到数据库视图（参见 `ViewEntity.ts`）。
- **`@Unique()`**：在字段或字段组合上定义唯一约束（参见 `Unique.ts`）。

### 5.2 列相关装饰器
- **`@Column()`**：在实体中定义列，指定数据类型和属性。
- **`@PrimaryColumn()`**：定义主键列。
- **`@PrimaryGeneratedColumn()`**：定义自动生成的主键列（例如自增 ID）。
- **`@CreateDateColumn()`**：定义创建日期列，自动记录实体创建时间。
- **`@UpdateDateColumn()`**：定义更新日期列，自动记录实体更新时间（参见 `UpdateDateColumn.ts`）。
- **`@VersionColumn()`**：定义版本列，用于乐观锁（参见 `VersionColumn.ts`）。
- **`@ViewColumn()`**：定义视图列，适用于视图实体（参见 `ViewColumn.ts`）。
- **`@VirtualColumn()`**：定义虚拟列，不存储在数据库中但可在查询中使用（参见 `VirtualColumn.ts`）。

### 5.3 关系相关装饰器
- **`@OneToOne()`**：定义一对一关系。
- **`@OneToMany()`**：定义一对多关系。
- **`@ManyToOne()`**：定义多对一关系。
- **`@ManyToMany()`**：定义多对多关系。

### 5.4 树结构相关装饰器
Lakutata 支持 TypeORM 的树结构功能，用于实现嵌套集或闭包表以处理层次数据：
- **`@Tree()`**：将实体标记为树结构实体（参见 `Tree.ts`）。
- **`@TreeChildren()`**：定义树结构的子节点属性（参见 `TreeChildren.ts`）。
- **`@TreeParent()`**：定义树结构的父节点属性（参见 `TreeParent.ts`）。
- **`@TreeLevelColumn()`**：定义树结构中的级别列，记录节点级别（参见 `TreeLevelColumn.ts`）。

### 5.5 使用示例
以下是一个简单的实体定义示例，展示了 TypeORM 装饰器的使用：
```typescript
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column()
  email: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```
- **说明**：`User` 类被标记为数据库实体，`id` 是一个自增主键，`name` 和 `email` 是普通列，`createdAt` 和 `updatedAt` 自动记录创建和更新时间。

## 总结

Lakutata 框架利用装饰器实现了高度模块化和声明式的开发方式。依赖注入装饰器（如 `@Inject`、`@Configurable`）简化了组件间的依赖管理；控制器行为装饰器（如 `@HTTPAction`、`@CLIAction`）提供了灵活的入口点行为定义；DTO 验证装饰器（如 `@Expect`）确保输入数据的有效性；数据库模型装饰器（从 TypeORM 集成）支持复杂的数据库操作和关系管理。这些装饰器共同构成了 Lakutata 框架强大的功能基础。

有关 Lakutata 其他功能的详细信息，请参阅相关文档章节。