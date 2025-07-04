# Lakutata - IoC-based Universal Application Framework

**Lakutata** is an **IoC (Inversion of Control)**-based universal application framework designed for TypeScript and Node.js developers. It provides a modular and extensible development environment to help developers build complex, enterprise-grade applications. Lakutata leverages dependency injection (DI), decorator patterns, and a component-based architecture to significantly reduce module coupling and enhance code maintainability and reusability.

## Highlights

- **IoC & Dependency Injection (DI)**: Decouple module dependencies with a powerful DI mechanism, enabling flexible component management.
- **Decorator-Driven Development**: Support for class, method, property, and parameter decorators to simplify metaprogramming and declarative development.
- **Modular Architecture**: Clear module separation, allowing developers to import only the required features, such as core functionality, ORM, or components.
- **ORM Integration**: Built on TypeORM, offering robust database operation abstractions and entity management.
- **Component-Based Design**: Includes out-of-the-box components (e.g., Docker, Database, Logger) to reduce development effort in specific domains.
- **Multi-Format Support**: Supports both ESM and CJS module formats for compatibility with various runtime environments.
- **Type Safety**: Deep integration with TypeScript, providing strong typing support and type declaration files.

## Feature Directory

Lakutata's functionality is categorized by domain and purpose, allowing developers to selectively use modules based on their needs. Below is a categorized overview of the framework's features:

### 1. Core Functionality
- **IoC Container**: Manages object lifecycles and dependencies, supporting singleton, transient, and other scopes.
- **Dependency Injection (DI)**: Automates dependency injection via decorators, simplifying dependency management between components.
- **Application Entrypoint**: Provides a unified mechanism for application startup and management.

### 2. Decorator Support
- **ASST Decorators**: Utility decorators to enhance class and method behaviors.
- **CTRL Decorators**: Controller decorators for defining routing and request handling logic.
- **DI Decorators**: Dependency injection decorators for declaring dependencies.
- **DTO Decorators**: Data Transfer Object decorators for data validation and transformation.
- **ORM Decorators**: Object-Relational Mapping decorators for defining database entities and relationships.

### 3. Data Management
- **ORM Integration**: Based on TypeORM, supporting multiple databases (e.g., MySQL, PostgreSQL, SQLite).
- **Database Component**: Provides an abstraction layer for database connection management and operations.
- **DTO Validation**: Supports JSON Schema and Joi for validating data structures.

### 4. Components & Services
- **Docker Component**: Integrates with Dockerode for Docker container management and operations.
- **Logger Component**: Based on Pino, offering high-performance logging capabilities.
- **Database Provider**: Encapsulates database connection logic for simplified configuration and usage.

### 5. Tools & Utilities
- **Helper Functions**: Provides commonly used utility functions and classes to streamline development.
- **Action Pattern**: Supports behavior pattern definitions for event-driven or command-based development.

## Getting Started

### Installation

```bash
npm install lakutata
