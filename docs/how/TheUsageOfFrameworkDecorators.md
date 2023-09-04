## Description

In the Lakutata framework, decorators are primarily divided into three categories: decorators used for controllers,
decorators used for dependency injection, and decorators used for validation.

### Controller Decorator

- `@Action()` decorator can only be used on methods that are exposed to the outside in the Controller, and the method
  must
  be public and must be an asynchronous method that accepts only one parameter.

### Dependency Injection Decorators

- `@Lifetime()` is used to declare the lifecycle pattern of a subclass of BaseObject. It accepts parameters SINGLETON,
  TRANSIENT, or SCOPED.
- `@Singleton()` is used to declare the lifecycle pattern of a subclass of BaseObject as Singleton.
- `@Transient()` is used to declare the lifecycle pattern of a subclass of BaseObject as Transient.
- `@Scoped()` is used to declare the lifecycle pattern of a subclass of BaseObject as Scoped.
- `@Inject()` is used to decorate the injection items within a subclass of BaseObject. It can accept the registration
  name
  of the injection item as a parameter.
- `@InjectApp()` is used to inject the application instance into a subclass of BaseObject.
- `@InjectModule()` is used to inject the Module instance that is used to instantiate the current class instance into a
  subclass of BaseObject.
- `@Configurable()` is used to declare properties as configurable within a subclass of BaseObject. Without using this
  decorator, object properties cannot be overridden by external values.

### Validation Decorators

- `@IndexSignature()` is used to declare and validate index signatures within DTOs.
- `@Expect()` is used to validate the property values within a DTO class.
- `@Accept()` can be used to validate the received parameters for any method within the framework.
- `@Return()` can be used to validate the data type of the return value for any method within the framework.

### ORM Decorators

Please refer to the decorators supported
by [TypeORM](https://github.com/typeorm/typeorm/blob/master/docs/decorator-reference.md) for decorators in ORM.
