## Description

Lakutata's dependency injection container is heavily inspired by [Awilix](https://github.com/jeffijoe/awilix). Although
Node.js itself does not provide a
built-in object destructor, the container division and management of container lifecycles in Lakutata allow for the
management of object lifecycles within the container. In Lakutata, for objects with a Transient lifecycle, the destroy
function within the object will still be called when the container is destroyed. This is achieved by using WeakRef to
manage the object references. If a Transient object still exists when the container is destroyed, its destroy function
will be explicitly called for cleanup.

The dependency injection container in the Lakutata framework is designed for asynchronous loading and registration of
modules. Therefore, the initialization functions in the BaseObject are all asynchronous functions. The registered
objects loaded using the @Inject() decorator within the objects, when loaded into the object, have already completed
their asynchronous initialization. Thus, they can be called normally within the object. However, for manual container
registration and retrieval of registered objects, the await keyword needs to be used for asynchronous waiting.

In general, the Container is not directly used. In Lakutata, the Module has integrated the Container into its class and
exposed the methods of the Container. In the createScope method exposed by the Module, the result returned will be an
instance of a child container. The methods that can be used on this child container instance are as follows:

## How to Use

### `load`

Loading injected project

- `options`: `Record<string, LoadEntryCommonOptions | LoadEntryClassOptions<T>>` - Injecting the configuration object of
  the project

### `get`

Fetching the registered project from the container by name or constructor

- `name`: `string | IConstructor<T>` - Registering the name or constructor of the project
- `configurableParams?`: `Record<string, any>` - Configurable parameter object
- Returns: `Promise<T>` - Register an instance of the project

### `set`

Injecting an object with the specified name or constructor

- `name`: `string | IConstructor<T>` - Registering the name or constructor of the project
- `options`: `LoadEntryClassOptions<T>` - Injecting the configuration object of the project
- Returns: `Promise<string>` - Injecting the name of the project

### `has`

Is the specified injection object present

- `name`: `string` - Injecting an object's name
- `constructor`: `IConstructor<T>` - Injecting an object's constructor
- Returns: `boolean` - Is the injected object present

### `createObject`

Injecting and creating an object with the specified name or constructor

- `name`: `string | IConstructor<T>` - Injecting the name or constructor of an object
- `options`: `LoadEntryClassOptions<T>` - Injecting configuration objects for objects
- Returns: `Promise<T>` - Injecting instances of objects

### `createScope`

Creating a scoped container with the current container as its parent container

- `module?`: `Module` - Modules of the scope container
- Returns: `Container` - Create a scope container

### `destroy`

Destroy the current container

- Returns: `Promise<void>`
