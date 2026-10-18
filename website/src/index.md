---
layout: home
titleTemplate: One programming model for every Node.js application

hero:
  name: Lakutata
  text: One programming model for every Node.js application
  tagline: An IoC framework for TypeScript. Web services, CLI tools, desktop and embedded applications share the same objects, validation and controllers.
  image:
    src: /logo.svg
    alt: Lakutata
  actions:
    - theme: brand
      text: Get started
      link: /guide/GettingStarted
    - theme: alt
      text: API reference
      link: /api/
    - theme: alt
      text: GitHub
      link: https://github.com/lakutata/lakutata

features:
  - title: Dependency injection
    details: A container creates your components, providers, modules and controllers, manages their lifetimes and validates their options. Construction is asynchronous, so an object can connect or load before it is used.
  - title: One controller, every transport
    details: Expose one method as an HTTP route, a CLI command, a service call (Socket.IO, JSON-RPC, gRPC, NATS, Electron IPC), a scheduled job and a queue consumer at the same time. Input validation, access control and middleware work the same way on every transport.
  - title: Validation everywhere
    details: DTOs validate options, inputs and results, convert to JSON Schema and produce typed errors.
  - title: Batteries included
    details: Databases (TypeORM), caching, locks, message queues (Redis, NATS, RabbitMQ, Kafka), internationalization, logging, Docker and containerd, hashing and encryption.
  - title: From the first line to the installer
    details: The lakutata command creates a project from a template, bundles it, and builds executables and installers.
  - title: Typed and documented
    details: ESM and CommonJS builds, complete type declarations, and an example for every public API.
---

## Quick start

```shell
npx @lakutata/cli create --name my-app
```

Or add the framework to a project:

```shell
npm install lakutata express
```

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {GET} from 'lakutata/decorator/ctrl'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'

class HelloController extends Controller {
    @GET('/hello')
    public async hello(): Promise<string> {
        return 'Hello, Lakutata'
    }
}

Application.run(() => ({
    id: 'hello.app',
    name: 'Hello',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [HelloController],
            //GET http://127.0.0.1:3000/hello
            http: expressHTTPEntrypoint({port: 3000})
        })
    },
    bootstrap: ['entrypoint']
}))
```

[Getting Started](/guide/GettingStarted) creates a first project; the [Overview](/guide/Overview) introduces the
concepts, and each guide then covers one part of the framework.
