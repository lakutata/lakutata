## Description

Component, which inherits from BaseObject, implements the EventEmitter interface, providing the ability to subscribe to
and publish events. Compared to BaseObject, Component has additional features such as default injection of the current
module instance and logging component, which can be accessed using this.module and this.log respectively. Component is
more oriented towards providing common methods for applications, such as database operations and permission control.
Although Component has a default lifecycle mode of Singleton, it can be modified to Scoped in subclasses that integrate
Component (although setting it to Transient is not recommended). This allows for independent instances in different
child containers.

By default, the lifecycle mode of Component is `Singleton`.

## How to Use

```typescript
import {Application, Component} from 'lakutata'
import {ThirdModule} from 'somewhere'

@Singleton()
class ExampleComponent extends Component {

    protected tm: ThirdModule

    /**
     * During Component initialization, it is possible to asynchronously initialize third-party modules.
     * @protected
     */
    protected async init(): Promise<void> {
        this.tm = await ThirdModule.initialize()
    }

    /**
     *During Component destruction, it is possible to destroy the third-party modules used within the component.
     * @protected
     */
    protected async destroy(): Promise<void> {
        await this.tm.destroy()
    }

    /*** Other Methods ***/
}
```
