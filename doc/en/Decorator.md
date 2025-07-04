# Lakutata Decorators

**Lakutata** is a universal application framework based on IoC (Inversion of Control), extensively utilizing decorators to enable metaprogramming. This simplifies dependency injection, controller behavior definition, data model management, and more. This document provides a detailed explanation of the various decorators used in the Lakutata framework and its integrations, including Lakutata's custom decorators and integrated TypeORM decorators.

## 1. Overview

In Lakutata, decorators are a core feature of TypeScript, used to attach metadata or behavior to classes, methods, or properties. Lakutata leverages decorators to implement dependency injection, controller routing, data validation, and integration with database ORMs like TypeORM. Decorators are categorized into the following groups:
- **Dependency Injection Decorators**: For managing dependencies and configuration injection.
- **Controller Behavior Decorators**: For defining behaviors of HTTP, CLI, and Service entry points.
- **DTO Validation Decorators**: For validating properties of Data Transfer Objects.
- **Database Model Decorators**: Integrated with TypeORM for defining entities, columns, relationships, and other database structures.

The following sections elaborate on the functionality and usage of each decorator category.

## 2. Dependency Injection Decorators

Dependency Injection (DI) is a core mechanism in Lakutata, with related decorators used to declare and manage dependencies between components, controllers, or providers.

### 2.1 `@Inject()`
- **Function**: Declares that a property or parameter requires dependency injection through the IoC container. It supports injection by type or by specific name.
- **Use Case**: Injecting services, loggers, or other dependencies into components, controllers, or providers.
- **Parameters**: Optional parameter to specify the name or type of the injected object (e.g., `Application`).
- **Example**:
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
- **Explanation**: In the example above, the `log` property is injected with a `Logger` instance via type inference, while the `app` property explicitly specifies injection of the `Application` instance.

### 2.2 `@Configurable()`
- **Function**: Injects configuration values into a property, typically used in providers or components to retrieve values from configuration objects.
- **Use Case**: Dynamically injecting external configuration parameters (e.g., paths, keys).
- **Parameters**: None, typically applied directly to properties.
- **Example**:
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
- **Explanation**: The `path` property retrieves its value from the application configuration, defined in `Application.run()` (e.g., via a `path` field).

### 2.3 `@Transient()`
- **Function**: Defines the lifecycle of a class as transient, meaning a new instance is created each time the object is requested.
- **Use Case**: Suitable for services that require independent state or resources, avoiding shared state in singleton mode.
- **Parameters**: None, typically applied at the class level.
- **Example**:
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
- **Explanation**: Each request for `TestProvider` results in a new instance returned by the IoC container, rather than a shared singleton.

## 3. Controller Behavior Decorators

Controllers (`Controller`) in Lakutata use decorators to define behaviors for handling HTTP requests, CLI commands, or service messages. These decorators specify routes, commands, or message patterns.

### 3.1 `@HTTPAction(route: string, methods: string | string[], dto?: DTO)`
- **Function**: Defines a controller method to handle specific HTTP request routes and methods (e.g., GET, POST).
- **Use Case**: Defining API endpoints in HTTP entry points.
- **Parameters**:
    - `route`: The route path, supporting parameterization (e.g., `/test/:id`).
    - `methods`: Supported HTTP methods, either a single string (e.g., `'GET'`) or an array (e.g., `['GET', 'POST']`).
    - `dto`: Optional parameter, specifying a Data Transfer Object (DTO) class for input data validation.
- **Example**:
  ```typescript
  import { Controller } from '../../components/entrypoint/lib/Controller.js';
  import { HTTPAction } from '../../decorators/ctrl/HTTPAction.js';
  import { DTO } from '../../lib/core/DTO.js';

  class TestDTO extends DTO {
    // DTO definition omitted
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
- **Explanation**: The `test` method handles GET requests for the `/test` path, while `test3` handles GET and POST requests for `/test/:id` and uses `TestDTO` for input validation.

### 3.2 `@CLIAction(command: string, dto?: DTO)`
- **Function**: Defines a controller method to handle a specific CLI command.
- **Use Case**: Defining command-line operations in CLI entry points.
- **Parameters**:
    - `command`: The command name.
    - `dto`: Optional parameter, specifying a DTO class for validating command arguments.
- **Example**:
  ```typescript
  import { Controller } from '../../components/entrypoint/lib/Controller.js';
  import { CLIAction } from '../../decorators/ctrl/CLIAction.js';
  import { DTO } from '../../lib/core/DTO.js';

  class TestDTO extends DTO {
    // DTO definition omitted
  }

  export class TestController1 extends Controller {
    @CLIAction('test3', TestDTO)
    public async test3(inp) {
      console.log('cli!');
      return 'oh!!!!!!!!!!';
    }
  }
  ```
- **Explanation**: The `test3` method handles the `test3` command and uses `TestDTO` to validate input arguments.

### 3.3 `@ServiceAction(pattern: object)`
- **Function**: Defines a controller method to handle specific service message patterns.
- **Use Case**: Processing real-time messages or other service requests in Service entry points.
- **Parameters**:
    - `pattern`: A message pattern object used to match service requests.
- **Example**:
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
- **Explanation**: The `test3` method processes service requests matching the specified pattern.

## 4. DTO Validation Decorators

Data Transfer Objects (DTOs) are used to validate input data, and Lakutata provides decorators to define validation rules for DTO properties.

### 4.1 `@Expect(rule: DTO.Rule)`
- **Function**: Defines validation rules for DTO properties, such as whether they are required or have type constraints.
- **Use Case**: Validating input data for HTTP requests or CLI commands within DTO classes.
- **Parameters**:
    - `rule`: A validation rule object, typically constructed using methods like `DTO.String()`, `DTO.Number()`, etc.
- **Example**:
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
- **Explanation**: The `aaa` property is an optional string, while `bbb` is a required number with an associated description.

## 5. Database Model Decorators (TypeORM Integration)

Lakutata integrates with TypeORM for database operations, providing numerous decorators to define entities, columns, relationships, and more. These decorators are directly referenced from the TypeORM library, with Lakutata offering convenient access through exports.

### 5.1 Entity-Related Decorators
- **`@Entity()`**: Marks a class as a database entity, mapping it to a database table.
- **`@ViewEntity()`**: Marks a class as a view entity, mapping it to a database view (see `ViewEntity.ts`).
- **`@Unique()`**: Defines a unique constraint on a field or combination of fields (see `Unique.ts`).

### 5.2 Column-Related Decorators
- **`@Column()`**: Defines a column in an entity, specifying data type and properties.
- **`@PrimaryColumn()`**: Defines a primary key column.
- **`@PrimaryGeneratedColumn()`**: Defines an auto-generated primary key column (e.g., auto-incrementing ID).
- **`@CreateDateColumn()`**: Defines a creation date column, automatically recording the entity creation time.
- **`@UpdateDateColumn()`**: Defines an update date column, automatically recording the entity update time (see `UpdateDateColumn.ts`).
- **`@VersionColumn()`**: Defines a version column for optimistic locking (see `VersionColumn.ts`).
- **`@ViewColumn()`**: Defines a view column, applicable to view entities (see `ViewColumn.ts`).
- **`@VirtualColumn()`**: Defines a virtual column, not stored in the database but usable in queries (see `VirtualColumn.ts`).

### 5.3 Relationship-Related Decorators
- **`@OneToOne()`**: Defines a one-to-one relationship.
- **`@OneToMany()`**: Defines a one-to-many relationship.
- **`@ManyToOne()`**: Defines a many-to-one relationship.
- **`@ManyToMany()`**: Defines a many-to-many relationship.

### 5.4 Tree Structure-Related Decorators
Lakutata supports TypeORM's tree structure functionality for implementing nested sets or closure tables for hierarchical data:
- **`@Tree()`**: Marks an entity as a tree structure entity (see `Tree.ts`).
- **`@TreeChildren()`**: Defines the children property of a tree structure (see `TreeChildren.ts`).
- **`@TreeParent()`**: Defines the parent property of a tree structure (see `TreeParent.ts`).
- **`@TreeLevelColumn()`**: Defines a level column in a tree structure to record node levels (see `TreeLevelColumn.ts`).

### 5.5 Usage Example
Below is a simple entity definition example showcasing the use of TypeORM decorators:
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
- **Explanation**: The `User` class is marked as a database entity, with `id` as an auto-incrementing primary key, `name` and `email` as regular columns, and `createdAt` and `updatedAt` automatically recording creation and update times.

## Summary

The Lakutata framework leverages decorators to enable a highly modular and declarative development approach. Dependency injection decorators (e.g., `@Inject`, `@Configurable`) simplify dependency management between components; controller behavior decorators (e.g., `@HTTPAction`, `@CLIAction`) provide flexible entry point behavior definitions; DTO validation decorators (e.g., `@Expect`) ensure input data validity; and database model decorators (integrated from TypeORM) support complex database operations and relationship management. Together, these decorators form the robust functional foundation of the Lakutata framework.

For detailed information on other Lakutata features, please refer to the relevant documentation sections.