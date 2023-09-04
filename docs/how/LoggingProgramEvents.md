## Description

The Logger component is a built-in component in the Lakutata framework. It
utilizes [Pino](https://github.com/pinojs/pino) as the provider for logging
functionality. What sets Logger apart from other components is that it can be used not only within the application but
also externally. Here is a typical example:

```typescript
import {Application, Logger} from 'lakutata'

(async (): Promise<void> => {
    try {
        await Application.run({
            /*** Options ***/
        })
    } catch (e) {
        Logger.error(e)
    }
})()
```

In the above example, when the Application fails to start, the Logger needs to output the error message. If the Logger
can only be used within the Application, this effect cannot be achieved.

## Use Case

There are three ways to use the Logger:

The first method is to obtain the instance of the Logger from the dependency injection container by using the key `log`.
In the framework, `log` is the fixed component name for the Logger.

```typescript
const log = await app.get<Logger>('log')
log.info(/*** Args ***/)
```

The second usage is to declare the Logger in other dependency-injected objects using decorators. This allows the
dependency injection container to automatically inject the Logger object when instantiating the dependent object.

```typescript
class Example extends BaseObject {
    @Inject()
    protected readonly log: Logger

    @Inject('log')
    protected readonly lloogg: Logger
}
```

The third method is to directly invoke the Logger's static methods. This method is typically used to capture errors
thrown by the application when it fails.

```typescript
Logger.info(/*** Args ***/)
```
