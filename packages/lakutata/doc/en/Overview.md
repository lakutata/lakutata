# Lakutata Overview

**Lakutata** is an IoC application framework for Node.js and TypeScript. It provides web services, CLI tools, desktop
(Electron, NW.js) applications and embedded devices with one programming model: an application is a tree of objects
(components, providers, controllers) that a container creates. DTOs validate their options and inputs, and transports
expose the controllers: HTTP (Express, Fastify), CLI (Commander), service RPC (HTTP, Socket.IO, JSON-RPC 2.0, gRPC,
NATS, Electron IPC, NW.js, React Native), schedules and message queues. One controller method can serve all of them at
the same time.

The `lakutata` package re-exports the `@lakutata/*` packages under its subpaths (see the table below) and presets two
components in every application: `log` (the `Logger`, which writes pino-compatible JSON lines) and `entrypoint` (the
`Entrypoint`, which serves the controllers).

## Where to start

[Getting Started](GettingStarted.md) describes how to create a first project from a template and presents a first
application. [Concepts](Concepts.md) explains the framework's model, and [Application Design](ApplicationDesign.md)
describes how to structure an application on it. [Project Structure](ProjectStructure.md) describes a project's files,
and the guides below cover each part of the framework. The [examples](examples/README.md) build complete applications
from the templates: a REST API, a command-line tool, a web application and a desktop application, calls between
services, background jobs, an MCP server and a service on a device.

## The subpaths

| Subpath | What it provides |
|---|---|
| `lakutata` | `Application`, `Module`, `Component`, `Provider`, `BaseObject`, `Container`, `DTO`, `Exception`, `Time`, `isPackaged`, `resourcesPath`, validation messages |
| `lakutata/decorator/di` | `@Inject`, `@Configurable`, `@Autoload`, `@Singleton`, `@Scoped`, `@Transient`, `@Lifetime` |
| `lakutata/decorator/dto` | `@Expect`, `@Accept`, `@Return`, `@IndexSignature` |
| `lakutata/decorator/asst` | `@Before`, `@After` |
| `lakutata/dtos` | `PaginationSearchDTO`, `PaginationResultDTO`, `paginator`, `FlexibleDTO`, JSON Schema conversion |
| `lakutata/com/entrypoint` | `Entrypoint`, `buildEntrypoints`, `Controller`, contexts, `Result`, access control, middlewares, `httpServiceEntrypoint`, `scheduleEntrypoint` |
| `lakutata/decorator/ctrl` | `@HTTPAction`, `@GET`…`@OPTIONS`, `@CLIAction`, `@ServiceAction`, `@Schedule`, `@Prefix`, `@UseMiddlewares` |
| `lakutata/adapter/express`, `lakutata/adapter/fastify` | The HTTP adapters |
| `lakutata/adapter/commander` | The CLI adapter |
| `lakutata/adapter/socket.io`, `lakutata/adapter/jsonrpc`, `lakutata/adapter/electron`, `lakutata/adapter/nwjs`, `lakutata/adapter/react-native` | The service adapters |
| `lakutata/com/logger` | The `Logger` component, preset as `log` (pino-compatible JSON lines) |
| `lakutata/orm`, `lakutata/decorator/orm` | TypeORM and its decorators |
| `lakutata/com/database`, `lakutata/provider/database` | The `Database` component and provider |
| `lakutata/com/cacher` | The `Cacher` component |
| `lakutata/com/mutex` | The `Mutex` component, `@Synchronized` |
| `lakutata/com/queue` | The `Queue` component, `@QueueAction`, `queueEntrypoint` |
| `lakutata/com/i18n` | The `I18n` component, the `Translator`, the language middleware |
| `lakutata/com/docker` | The `Docker` component |
| `lakutata/com/containerd` | The `Containerd` component |
| `lakutata/com/monitor` | CPU, memory, event loop and HTTP monitors |
| `lakutata/security`, `lakutata/provider/passwordHash` | Hashing, ciphers, signatures, the `PasswordHash` provider |
| `lakutata/utils` | Helper functions |

The following are separate packages: `@lakutata/cli` (the `lakutata` command for creating projects, running migrations
and packing applications, see [Command-Line Tool](Command.md)), `@lakutata/grpc` (a gRPC client, server and service
adapter), `@lakutata/nats` (a NATS component and service adapter), `@lakutata/dbus` (D-Bus), `@lakutata/mcp` (the Model
Context Protocol), `@lakutata/webrtc` (WebRTC signaling, a TURN server, a media server, peer connections),
`@lakutata/ffi` (the C functions of native libraries), `@lakutata/math` (symbolic and numeric mathematics, as functions
that need no Lakutata application), `@lakutata/barcode` (barcodes and QR codes, generated and read in a native addon),
`@lakutata/netif` (servers and UDP sockets listening on a network interface regardless of its addresses, the machine's
interfaces and their changes), `@lakutata/mongo-embedded` (the embedded MongoDB that `mongo-embedded` databases use, in
a native addon), `@lakutata/thermal` and `@lakutata/thermal-printer` (thermal printers, with receipts and labels written
in HTML, and a manager component), `@lakutata/serial` (serial ports and Bluetooth devices), and `@lakutata/ldap` with
`@lakutata/ldap-engine` (signing users in against an LDAP directory, and the application's own LDAP directory server).

## The guides

| Guide | Topic |
|---|---|
| [Getting Started](GettingStarted.md) | Requirements, creating a project, adding Lakutata to an existing project, a first application |
| [Concepts](Concepts.md) | The framework's model: an application as a tree of objects, the base classes and the reasons for their design, lifetimes, options, actions and transports, terminology |
| [Project Structure](ProjectStructure.md) | Files, scripts and features of projects created from the templates, and custom templates |
| [Application Design](ApplicationDesign.md) | Structuring an application: each part's class, where logic and state live, configuration, creation order, tests |
| [Upgrading from Lakutata 2.x](UpgradingFrom2.md) | Upgrading a project from Lakutata 2.x (the `lakutata` 2.x package) |
| [Upgrading from Lakutata 1.x](UpgradingFrom1.md) | Porting a project from Lakutata 1.x (`@lakutata/core` 1.x and the `@lakutata-module/*`, `@lakutata-component/*` packages) |
| [Application](Application.md) | The application: its options, fluent API, lifecycle and mode, packed applications |
| [Objects and Lifetimes](Objects.md) | Components, providers and their container: lifetimes, scopes, creation and teardown, a container without an application |
| [Dependency Injection](Injection.md) | Dependency injection, object options, sharing features between applications |
| [Modules](Modules.md) | Modules: features with their own components and providers, how their objects are resolved, configuring them from the application |
| [DTO and Validation](DTOValidation.md) | DTOs and schemas: validating options, inputs and results |
| [Exceptions](Exceptions.md) | Declaring exceptions, their messages, what clients receive, the framework's exceptions |
| [Logging](Logger.md) | The `log` component: writing lines, readable lines or JSON, destinations, another logger |
| [Decorators](Decorator.md) | The decorators, by subpath |
| [Time](Time.md) | The `Time` class |
| [Helper Functions](HelperFunctions.md) | The helper functions of `lakutata/utils` |
| [Controllers and Actions](Controllers.md) | Controllers and actions: their addresses, input and results, prefixes, inheritance |
| [Entrypoint](Entrypoint.md) | The entrypoint component: its options and adapters, starting and stopping, the list of actions |
| [Middlewares and Access Control](Middlewares.md) | Middlewares and access control for actions |
| [HTTP](HTTP.md) | The HTTP adapters: routes, input, responses, errors, Express and Fastify features |
| [Command Line](CLI.md) | Command-line tools: commands, options, prompts, output and exit codes |
| [Service Calls](ServiceCalls.md) | Service actions over HTTP, Socket.IO, JSON-RPC 2.0, Electron and NW.js: patterns, responses, clients and their events |
| [gRPC](GRPC.md) | Service actions over gRPC (`@lakutata/grpc`), and calling them from other applications and languages |
| [NATS](NATS.md) | The NATS component, service actions over NATS (`@lakutata/nats`), service proxies and their events |
| [Scheduled Jobs](Schedules.md) | Scheduled jobs: intervals, cron expressions, jobs run by one instance |
| [Queues](Queue.md) | Message queues: producers, `@QueueAction` consumers, retries, dead letters, results |
| [Databases](Database.md) | The `Database` component and provider, connection options, multiple databases |
| [Database Drivers](DatabaseDrivers.md) | Each database driver: what to install, its options, its limits |
| [Embedded MongoDB](MongoEmbedded.md) | A MongoDB inside the application (`@lakutata/mongo-embedded`) that keeps its documents in a file |
| [Entities, Queries and Transactions](Entities.md) | Entities, queries, transactions and errors |
| [Migrations](Migrations.md) | Writing, generating and running migrations |
| [Cache](Cache.md) | The `Cacher` component: `wrap()`, stores and their tiers, what they keep |
| [Mutex](Mutex.md) | Locks shared between processes and instances |
| [Internationalization (i18n)](I18n.md) | Messages in several languages |
| [Docker Integration](DockerIntegration.md) | The `Docker` component |
| [Containerd Integration](ContainerdIntegration.md) | The `Containerd` component |
| [Monitors](Monitor.md) | The CPU, memory, event loop and HTTP request monitors |
| [Security](Security.md) | Hashing, ciphers, signatures, passwords |
| [D-Bus](DBus.md) | A D-Bus service and client (`@lakutata/dbus`): methods, objects, properties, signals |
| [MCP](MCP.md) | Model Context Protocol tools, resources and prompts (`@lakutata/mcp`), over stdio and HTTP |
| [WebRTC](WebRTC.md) | Peer-to-peer connections and a media server (`@lakutata/webrtc`): signaling, the TURN server, browsers and applications, an application's actions called through data channels, WHIP and WHEP |
| [FFI](FFI.md) | The C functions of native libraries (`@lakutata/ffi`): declarations copied from headers, structs, callbacks, memory, packaging |
| [Barcode](Barcode.md) | Barcodes and QR codes (`@lakutata/barcode`): generating them as PNG, SVG or pixels, sizes for print, EAN, UPC and GS1, reading them from images |
| [Thermal Printers](Thermal.md) | Thermal printers (`@lakutata/thermal`, `@lakutata/thermal-printer`, `@lakutata/serial`): receipts, labels and wristbands written in HTML, choosing and saving printers, cutting, connections, serial ports and Bluetooth |
| [LDAP](LDAP.md) | The LDAP components (`@lakutata/ldap`): signing users in against a directory from a controller, reading and writing it, serving a directory from the application's database, its schema, access and password policy, custom plugins, connecting SSSD, Keycloak and Gitea |
| [Math](Math.md) | Mathematics (`@lakutata/math`): formulas and exact results, equations, decimals of any precision, matrices, statistics, numeric solutions, units |
| [Netif](Netif.md) | Network interfaces (`@lakutata/netif`): a server listening on an interface regardless of its addresses, connections through other interfaces refused, the interfaces and their changes, UDP on one interface |
| [Serial](Serial.md) | Serial ports (`@lakutata/serial`): a port as a stream, its line and modem lines, finding a port by its USB adapter's IDs, unplugged devices, classic Bluetooth devices |
| [LDAP Engine](LDAPEngine.md) | LDAP without an application (`@lakutata/ldap-engine`): the client and its pool, signing users in, Active Directory, filters, DNs, schemas, LDIF, a server with custom backends, plugins, the protocol |
| [Command-Line Tool](Command.md) | The `lakutata` command: creating projects, migrations, translations, environment variables |
| [Workspaces](Workspaces.md) | Multi-package projects: running scripts, versioning packages, adding packages |
| [Native Addons](NativeAddons.md) | Native addons in C++ or Rust: creating them, linking libraries, shipping them |
| [Packaging](Packaging.md) | Bundles and executables, and what a packed application reads at run time |
| [Installers](Installers.md) | Each platform's installers, services, installer scripts, signing |

Each `@lakutata/*` package has its own README, and every subpath's type declarations document each export with an
example.
