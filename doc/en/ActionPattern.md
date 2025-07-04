# Lakutata Action Pattern

**Lakutata** is a universal application framework based on IoC (Inversion of Control), designed to provide a modular and extensible development experience for TypeScript and Node.js developers. In terms of operation dispatching and entry point definition, Lakutata offers the **Action Pattern** system, which maps requests or commands to controller methods through pattern matching, enabling flexible operation invocation. This document provides a detailed explanation of the Action Pattern definition, core decorators, pattern management mechanisms, and usage examples within the Lakutata framework.

## 1. Action Pattern Functionality Overview

**Action Pattern** is a mechanism in the Lakutata framework for defining and matching operation patterns, primarily used for registering and invoking entry points of controller methods. Action Pattern allows developers to map HTTP requests, command-line operations, or service calls to specific methods in controllers through defined patterns, thereby achieving operation dispatching and handling. Lakutata's Action Pattern system supports multiple entry types, including HTTP requests, command-line operations, and service operations, and leverages a pattern-matching engine for efficient operation lookup and execution.

### 1.1 Core Purpose of Action Pattern
- **Operation Mapping**: Maps specific requests or commands to methods within controllers, ensuring accurate operation dispatching.
- **Entry Point Definition**: Defines operation entry points through decorators, supporting various entry types (e.g., HTTP, CLI, service calls).
- **Pattern Matching**: Utilizes pattern matching mechanisms to flexibly handle complex service operation calls.

### 1.2 Integration with Lakutata
Lakutata provides three core Action decorators (`@HTTPAction`, `@CLIAction`, `@ServiceAction`) for registering controller methods as different types of operation entry points. Combined with the `ActionPattern` type and `PatternManager` pattern manager, Lakutata efficiently handles pattern matching and operation invocation. Furthermore, the Action Pattern system integrates with the DTO system, supporting input data validation to ensure operation security and consistency.

## 2. Action Pattern Core Components

### 2.1 ActionPattern Type
`ActionPattern` is a key-value pair record type (`Record<string, any>`), capable of containing arbitrary properties and supporting generic extensions for type safety. It is primarily used for defining patterns in service operations.

### 2.2 Action Decorators
Lakutata provides three Action decorators for registering controller methods as specific types of operation entry points.

#### 2.2.1 @HTTPAction
The `@HTTPAction` decorator is used to register controller methods as entry points for HTTP requests.

- **Parameters**:
  - `route`: HTTP route path (e.g., `/users`).
  - `method` or `methods`: HTTP request method(s), which can be a single method (e.g., `'GET'`) or multiple methods (e.g., `['GET', 'POST']`).
  - `dtoConstructor` (optional): DTO class for validating request data.
- **Example**:
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
- **Explanation**: The `getUsers` method is registered as the entry point for GET requests to `/users`; the `createUser` method is registered as the entry point for POST requests to `/users` and uses `UserDTO` to validate request data.

#### 2.2.2 @CLIAction
The `@CLIAction` decorator is used to register controller methods as entry points for command-line operations.

- **Parameters**:
    - `command`: Command string (e.g., `user:create`).
    - `dtoConstructor` (optional): DTO class for validating command parameters.
- **Example**:
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
    - **Explanation**: The `createUser` method is registered as the entry point for the `user:create` command and uses `UserDTO` to validate command parameters.

#### 2.2.3 @ServiceAction
The `@ServiceAction` decorator is used to register controller methods as entry points for service operations.

- **Parameters**:
    - `pattern`: Operation pattern based on the `ActionPattern` type, allowing the definition of arbitrary key-value pair patterns.
    - `dtoConstructor` (optional): DTO class for validating operation data.
- **Example**:
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
    - **Explanation**: The `createUser` method is registered as the entry point for the `{ action: 'createUser', module: 'user' }` pattern, suitable for inter-service calls, and uses `UserDTO` to validate data.

### 2.3 Pattern Manager (PatternManager)
`PatternManager` is the core component in Lakutata for handling pattern matching in service operations, implemented based on the `Patrun` library.

- **Functionality**:
    - Registers patterns and their corresponding objects (controller methods).
    - Finds patterns matching a given subject, supporting exact matching (via the `exact` parameter).
    - Lists all registered patterns that include a partial pattern.
    - Supports wildcard matching (through the `globMatch` option).
- **Role**: `PatternManager` ensures that service operation patterns are efficiently mapped to controller methods, suitable for complex pattern-matching scenarios.

## 3. Action Pattern Use Cases

- **HTTP Request Handling**: Using the `@HTTPAction` decorator, controller methods are mapped to specific HTTP routes and methods to handle API requests.
- **Command-Line Tool Development**: Using the `@CLIAction` decorator, controller methods are mapped to command-line commands, supporting the development of command-line tools.
- **Inter-Service Communication**: Using the `@ServiceAction` decorator and `ActionPattern`, inter-service operation calls based on pattern matching are achieved, suitable for microservice architectures or modular systems.
- **Flexible Pattern Matching**: Leveraging `PatternManager` and the `Patrun` library, complex pattern matching rules are supported, allowing developers to define custom patterns to meet specific needs.

## 4. Advantages and Features of Action Pattern

- **Multi-Entry Support**: Lakutata's Action Pattern system supports HTTP, CLI, and Service entry types, covering a wide range of application scenarios.
- **Efficient Pattern Matching**: Implemented via the `Patrun` library, `PatternManager` enables efficient pattern matching, particularly suitable for complex `ServiceAction` scenarios.
- **Integration with DTO**: All Action decorators support specifying a DTO class for validating input data, ensuring operation security and consistency.
- **Declarative Definition**: Operation entry points are defined declaratively through decorators, keeping the code concise and maintainable.

## Summary

Lakutata's Action Pattern system, through the `@HTTPAction`, `@CLIAction`, and `@ServiceAction` decorators, provides a flexible mechanism for defining and registering operation entry points. Combined with the `ActionPattern` type and `PatternManager` pattern manager, Lakutata efficiently maps requests or commands to controller methods, supporting various scenarios such as HTTP request handling, command-line operations, and inter-service communication. The integration of Action Pattern with the DTO system further ensures data validation and security, enhancing the modularity and scalability of applications.