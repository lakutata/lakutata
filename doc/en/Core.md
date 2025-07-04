# Lakutata Core Features

**Lakutata** is a universal application framework based on IoC (Inversion of Control), designed for TypeScript and Node.js developers. Its core features provide foundational mechanisms for dependency management, application structure organization, and lifecycle definition. This document elaborates on Lakutata's core functionalities, including the IoC Container, Dependency Injection (DI), and Application Entry Points.

## 1. IoC Container

The **IoC Container** is the central component of the Lakutata framework, responsible for implementing the Inversion of Control principle to decouple modules and manage object lifecycles. It serves as a registry and factory for application components, providers, and modules, ensuring dynamic resolution of dependencies at runtime.

### Key Features
- **Object Lifecycle Management**: The IoC Container supports various lifecycle scopes, defined via decorators (e.g., `@Transient()`):
  - **Singleton (Default)**: Only one instance is created and shared across the entire application.
  - **Transient**: A new instance is created each time the object is requested, as seen with `@Transient()` in `TestProvider.ts`.
  - Other Custom Scopes: Further defined through configuration or decorators.
- **Dependency Resolution**: Automatically resolves dependencies based on registered components, providers, or modules, reducing manual instantiation efforts.
- **Provider Registration**: Supports registering classes or services as providers (`Provider`), with paths or classes specified in application configuration, as with `TestProvider`.
- **Component Management**: Enables registration and initialization of components (`Component`), which can be infrastructure services like logging or custom functional modules.
- **Modular Support**: Allows functionality to be organized into modules (`Module`) for better code organization and reuse.

### Usage Example
Below is an example based on the provided test code, demonstrating how to register and use components and providers in Lakutata:

```typescript
import { Application } from '../lib/core/Application.js';
import { TestComponent } from './components/TestComponent.js';
import { TestProvider } from './providers/TestProvider.js';
import path from 'node:path';

// Configure the application and register components and providers
Application.run(() => ({
  id: 'test.app',
  name: 'TestApp',
  timezone: 'auto',
  components: {
    testComponent: {
      class: TestComponent
    }
  },
  providers: {
    testProvider: {
      class: TestProvider,
      path: path.resolve('@test2', './hahahaha')
    }
  },
  bootstrap: ['testComponent']
}));
```

### Benefits
- Reduces coupling between modules by managing object creation through the container.
- Supports flexible lifecycle configurations for resource management and performance optimization.
- Provides a unified dependency resolution mechanism, simplifying complex application development.

## 2. Dependency Injection (DI)

**Dependency Injection (DI)** is a key design pattern in Lakutata for decoupling components. Through the IoC Container, Lakutata allows developers to declare dependencies required by components or controllers without manually instantiating them. Dependency Injection is primarily implemented via decorators.

### Key Features
- **Decorator Injection**: Uses the `@Inject()` decorator to declare dependencies to be injected, supporting injection by type or by name.
- **Custom Configuration**: Uses the `@Configurable()` decorator to inject configuration values into providers or components, as seen with the `path` property in `TestProvider.ts`.
- **Multi-Level Dependencies**: Supports nested dependency injection across components, controllers, and providers, with the IoC Container automatically resolving dependency chains.
- **Application Instance Injection**: Allows direct injection of the `Application` instance to access global configurations or control application lifecycle, as demonstrated in `TestController1.ts`.

### Usage Example
Below is a practical example of Dependency Injection based on `TestComponent.ts` and `TestController1.ts`:

```typescript
import { Component } from '../../lib/core/Component.js';
import { Inject } from '../../decorators/di/Inject.js';
import type { Logger } from '../../components/Logger.js';
import { Application } from '../../lib/core/Application.js';
import { Controller } from '../../components/entrypoint/lib/Controller.js';

// Using Dependency Injection in a Component
export class TestComponent extends Component {
  @Inject()
  protected readonly log: Logger;

  protected async init(): Promise<void> {
    this.log.info('TestComponent initialized');
  }
}

// Using Dependency Injection in a Controller
export class TestController1 extends Controller {
  @Inject()
  protected readonly log: Logger;

  @Inject(Application)
  protected readonly app: Application;

  protected async init(): Promise<void> {
    this.log.info('TestController initialized');
  }
}
```

### Benefits
- Simplifies dependency declaration via the `@Inject()` decorator, avoiding manual instantiation.
- Supports injection of the `Application` instance for easy access to global configurations or application control.
- Enhances code maintainability and facilitates testing by allowing dependency substitution.

## 3. Application Entry Points

**Application Entry Points** are core mechanisms in Lakutata for starting and managing the application lifecycle. Through the `Application` class, they provide a unified approach for application configuration, component registration, and bootstrap initialization. Lakutata supports multiple entry point types, including HTTP, CLI, and Service entry points, to accommodate diverse application scenarios.

### Key Features
- **Application Configuration**: Defines the application’s ID, name, timezone, components, providers, modules, and bootstrap items (`bootstrap`) via the `Application.run()` method.
- **Multiple Entry Point Support**: Lakutata designs entry points as an abstraction layer, allowing developers to freely choose specific implementation frameworks or libraries as long as they can integrate with the framework’s entry point mechanism. The framework provides `BuildEntrypoints` and related helper methods (e.g., `BuildHTTPEntrypoint`, `BuildCLIEntrypoint`, `BuildServiceEntrypoint`) to assist developers in defining entry points:
    - **HTTP Entry Point**: For handling HTTP requests, developers can choose to use Fastify or other HTTP frameworks, needing only to implement the request handling logic and integrate with Lakutata’s `HTTPContext`.
    - **CLI Entry Point**: For command-line interactions, developers can opt for Commander.js or other CLI tools, simply connecting the command handling logic with Lakutata’s `CLIContext`.
    - **Service Entry Point**: For real-time communication or other service scenarios, developers can select Socket.IO or other communication libraries, integrating with Lakutata’s `ServiceContext`.
- **Lifecycle Management**: Provides hooks like `onLaunched`, `onDone`, and `onFatalException` for executing custom logic during application startup, completion, or error scenarios.
- **Environment Variable Support**: Sets environment variables via the `Application.env()` method, accessible throughout the application.

### Usage Example
Below is an example of application entry point configuration and startup based on `App.spec.ts`:

```typescript
import { Application } from '../lib/core/Application.js';
import { TestComponent } from './components/TestComponent.js';
import { TestController1 } from './controllers/TestController1.js';
import { BuildEntrypoints, BuildHTTPEntrypoint } from '../components/entrypoint/Entrypoint.js';

// Configure and start the application
Application
  .env({ TEST: '123' }) // Set environment variables
  .run(() => ({
    id: 'test.app',
    name: 'TestApp',
    timezone: 'auto',
    components: {
      testComponent: {
        class: TestComponent
      },
      entrypoint: BuildEntrypoints({
        controllers: [TestController1],
        http: BuildHTTPEntrypoint((module, routeMap, handler, onDestroy) => {
          // Developers can freely choose HTTP framework for implementation
          // Specific implementation code omitted, refer to App.spec.ts
        }),
        // CLI and Service entry point configurations omitted
      })
    },
    bootstrap: ['entrypoint']
  }))
  .onLaunched(async (app, log) => {
    log.info('Application %s launched', app.appName);
  })
  .onDone(async (app, log) => {
    log.info('Application %s done', app.appName);
  })
  .onFatalException((error, log) => {
    log.error('Application error: %s', error.message);
    return 100;
  });
```

### Benefits
- Provides a unified `Application` class for application configuration and startup, simplifying the initialization of complex applications.
- Abstracted entry point design grants developers high flexibility to choose suitable frameworks or libraries for specific functionality.
- Supports custom logic through lifecycle hooks, facilitating debugging and extension.

## Summary

Lakutata’s core features—including the IoC Container, Dependency Injection, and Application Entry Points—provide developers with a powerful framework for building modular and scalable applications. By managing dependencies and object lifecycles through the IoC Container, simplifying inter-component relationships via Dependency Injection, and offering flexible startup and management through Application Entry Points, Lakutata effectively addresses needs ranging from simple scripts to complex enterprise applications.

For detailed information on controller behavior definition, Data Transfer Objects (DTOs), or other modules, please refer to the relevant documentation sections.