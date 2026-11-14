# Lakutata Concepts

This guide describes the model that every Lakutata application follows: the objects an application consists of, the
classes they extend, and the reasons behind their design. [Objects and Lifetimes](Objects.md), [Dependency
Injection](Injection.md) and [Modules](Modules.md) describe the exact rules; [Application Design](ApplicationDesign.md)
applies the model to structuring an application.

## 1. An application is a tree of objects

A Lakutata application consists of objects that an IoC container creates. The application declares them in its options
(which class serves each name, and with which options); the container creates each object when it is first requested,
or at launch when the application lists it in `bootstrap`. Objects never create one another with `new`: each object
declares the objects it needs, and the container provides them.

Every object owns a container, and the objects created in it belong to the object. The application is therefore the
root of a tree, and the tree determines how long each object lives:

```text
Application                  the root: declares the objects below and runs the process
├── log                      component, preset by the lakutata package: the logger
├── orders                   component: the orders, shared by every request
├── payments                 module: a feature, with the objects it declares
│   ├── gateway              component of the module
│   └── refunds              provider of the module
└── entrypoint               component: serves the controllers over the transports
    └── scope of a request   created for each request, destroyed when the request ends
        ├── OrderController  controller: one instance for the request
        └── CurrentUser      provider: one instance for the request
```

When a request ends, its scope is destroyed, together with the controller and providers created for it. When the
application stops, the entrypoint stops accepting requests, and the objects in the tree are destroyed. The container
provides each dependency once it is ready, and destroys each object together with its owner: application code declares
its objects, and the framework manages their lifecycle.

## 2. The base classes

Each object in the tree extends one of the framework's base classes:

```text
BaseObject                 every object the container creates; @Transient by default
└── Provider               a unit of work that lives in a scope; @Scoped by default
    ├── Controller         handles the requests of the entrypoint; @Scoped, locked
    └── Component          a long-lived service of the application; @Singleton, locked
        └── Module         a component that declares its own objects
            └── Application    the root module, created by Application.run()
```

- **`BaseObject`** provides what every object has: asynchronous construction, lifecycle hooks, options validated by
  schemas, and access to the container (`getObject()`). A class that extends it directly is transient: each object that
  requests it receives a new instance. It suits a helper that keeps its own state, such as the `Stopwatch` in
  [Dependency Injection](Injection.md).
- **`Provider`** is a unit of work that lives in a scope: one instance per scope, shared by the objects in that scope
  and destroyed with it. Each request that the entrypoint handles is a scope, so a provider can hold one request's state
  (the signed-in user, for example) without that state reaching another request. Typical providers are a repository, a
  password hasher and a client configured per request.
- **`Component`** is a long-lived service shared by the whole application: a logger, a database connection, a cache, an
  entrypoint. It is a singleton, and its lifetime is locked, so a subclass cannot make it scoped or transient. It owns
  the resources that must exist only once (connections, servers, timers, files), and it is an event emitter: other
  objects react to its changes by listening to its events instead of being called by it.
- **`Controller`** handles requests from the entrypoint. Each request creates its own controller, with that request's
  context and abort signal, and destroys it when the request ends. A controller therefore keeps no state between
  requests: state that outlives a request belongs to a component.
- **`Module`** is a component that declares its own components, providers and objects, as the application does. Its
  objects resolve their dependencies in the module first, then in the application, while the application's other objects
  cannot inject them. A module groups a feature's objects behind one object.
- **`Application`** is the root module. It adds process-level concerns: the launch, shutdown signals and the exit code,
  the mode, environment variables and path aliases.

Two classes stand outside the tree. A **`DTO`** describes data with schemas (an action's input, a message, an object's
options); the framework validates values against it but does not create it as an object. The **`Container`** is the
container itself; tests, scripts and libraries can create one and use framework objects without an application ([Objects
and Lifetimes](Objects.md), section 5).

## 3. Declaring instead of constructing

An object states what it needs, and the application states how to provide it:

- `@Inject('mailer')` on a property declares that the object needs the object registered as `mailer`;
- `@Configurable(schema)` on a property declares an option of the object, with the schema its value must match;
- the application options declare which class serves each name, and with which options:
  `mailer: {class: Mailer, host: 'smtp.example.com'}`.

Because an object's dependencies are declared rather than constructed, the same class can serve several applications
with different options, as the framework's packages do ([Dependency Injection](Injection.md), section 3). The
application checks the options of every object it declares when it launches, so the launch fails on a configuration
mistake even in an object that is never used. A test can launch the application with the options it needs, or replace
the class that serves a name, without changing the objects that inject it.

## 4. Asynchronous construction

Object construction is asynchronous: an object can connect to a server, open a file or load data before it is used, and
`getObject()` resolves only once the object is ready. Each step has its own hook:

| Hook | Runs | Typical use |
|---|---|---|
| `init()` | After the dependencies are injected and the options are set | Connecting, loading, checking the configuration; creation fails if it throws |
| `startup()` | After `init()`; objects that request it wait until it completes | Starting what other objects rely on, such as a server that starts listening |
| `launched()` | Once the application has launched; not awaited | Work that needs the whole application to be ready |
| `beforeDestroy()` | First, when the object's destruction begins | Refusing new work, and no longer using other objects |
| `destroy()` | Last, once the objects it owns are destroyed | Releasing its own resources: connections, timers, files |

An object therefore receives its dependencies once they are ready. The exceptions, during a `startup()` and within a
module's bootstrap, are described in [Objects and Lifetimes](Objects.md), section 4, and [Modules](Modules.md),
section 3.

## 5. Lifetimes and scopes

A class's lifetime determines how many instances the container creates:

- a **singleton** has one instance per container that registers it: the application's resources and state;
- a **scoped** class has one instance per scope: the state of one request, shared by that request's controller and
  providers;
- a **transient** class has a new instance each time an object requests it: helpers whose state belongs to the
  object that uses them.

The entrypoint creates a scope for each request, so the scoped objects of one request never share state with those of
another, and the scope releases them when the request ends. Each base class's default lifetime follows its role:
components are singletons, providers and controllers are scoped, other objects are transient. The rules, including what
a singleton receives when it injects a scoped object, are described in [Objects and Lifetimes](Objects.md).

## 6. Options as a contract

An object's options are its properties marked `@Configurable`, each with a schema. These schemas form the contract
between an object and the application that declares it: the application provides the values in its options, and the
framework validates and converts them before `init()` runs. The application options, in turn, are usually built by a
function (`config()` in the templates) that reads environment variables, and a test calls the same function with the
values it needs ([Application Design](ApplicationDesign.md), section 5).

## 7. One action, every transport

A controller's actions are its methods that carry an action decorator. The decorators specify an action's address on
each transport: an HTTP route (`@GET('/orders/:id')`), a command (`@CLIAction('order')`), a service pattern
(`@ServiceAction({cmd: 'order.get'})`), a schedule (`@Schedule`) or a queue (`@QueueAction`). Adapters, such as
`expressHTTPEntrypoint()` or `commanderCLIEntrypoint()`, translate a transport's requests into action calls, and the
results and exceptions of the actions into responses.

An action therefore receives its input already validated by its DTO, whatever the transport, and returns a result; it
does not depend on the transport that called it. Input validation, access control, and the middlewares of the entrypoint
and controllers apply in the same way on every transport. An exception becomes an HTTP status, a service call's error
response or a command's exit code, depending on the transport. The same method can serve several transports at the same
time ([Controllers and Actions](Controllers.md)).

## 8. Terms

| Term | Meaning |
|---|---|
| Application | The root object of a program, created by `Application.run()` |
| Object | An instance of a class that extends `BaseObject`, created by a container |
| Declaration | An object's entry in the options of an application or module: `{class, ...options}` |
| Component | A singleton object of the application: a service or a resource |
| Provider | An object that lives in a scope, one instance per scope |
| Module | A component that declares its own objects |
| Controller | A class whose methods serve requests from the entrypoint |
| Action | A controller method bound to an address by an action decorator |
| Entrypoint | The component that serves the controllers through its adapters, declared by `buildEntrypoints()` |
| Adapter | The part of the entrypoint that serves one transport, such as `expressHTTPEntrypoint()` |
| Transport | A way to reach the actions: HTTP, the command line, service calls, schedules, message queues |
| Driver | A component's backend, such as the database of the `Database` component or the broker of the `Queue` component |
| Scope | A child container that holds one instance of each scoped class; the entrypoint creates one for each request |
| Lifetime | The rule that determines how many instances of a class the container creates: singleton, scoped, transient |
| DTO | A class that describes data with schemas, used to validate options, input and results |
| Bootstrap | The steps the application runs at launch, in order: the objects to create, and functions to call |
