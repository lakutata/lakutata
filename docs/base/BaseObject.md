## Description

BaseObject, as the most fundamental object class within the framework, serves to restrict the types that can be accepted
by dependency injection in the framework. It also provides a series of basic methods for all subclasses that inherit
from this class, including the crucial object lifecycle management methods within the Lakutata framework. In addition,
BaseObject provides an interface for retrieving the object lifecycle type (SINGLETON, TRANSIENT, SCOPED), allowing the
framework's dependency injection to recognize the desired lifecycle mode for the injected class during startup.

By default, the lifecycle mode of BaseObject is `Transient`.

## How to Use

Although BaseObject serves as the most fundamental object class within the framework, you can still directly write
subclasses of this base class. Additionally, all subclasses that inherit from this base class can utilize the
framework's dependency injection mechanism for loading and invocation.

```typescript
import {BaseObject, Configurable, Scoped} from 'lakutata'

/**
 * The use of @Scoped(), @Singleton(), or @Transient() decorators on subclasses that inherit from BaseObject represents the lifecycle mode of that class.
 * @Scoped() decorator indicates that the class has a scoped lifecycle, meaning a new instance will be created for each scope or request.
 * @Singleton() decorator indicates that the class has a singleton lifecycle, meaning only one instance will be created and shared across the application.
 * @Transient() decorator indicates that the class has a transient lifecycle, meaning a new instance will be created each time it is injected or requested.
 */
@Scoped()
class ExampleObject extends BaseObject {

    /**
     * Properties decorated with the @Configurable() decorator can load external configuration parameters when obtaining objects through the dependency injection container.
     * @protected
     */
    @Configurable()
    public readonly prop

    protected async init(): Promise<void> {
        /*** The code placed here will be executed during object initialization ***/
    }

    protected async destroy(): Promise<void> {
        /*** The code placed here will be executed during object destruction. ***/
    }
}
```

Once the declaration of a class that inherits from BaseObject is written, you can declare it in the application's
startup configuration.

```typescript
import {Application, Logger, Container} from 'lakutata'
import {errors} from '@sideway/address'

Application.run({
    /* ...other properties */
    entries: {
        example: {
            class: ExampleObject,
            //Properties decorated with the @Configurable() decorator can be injected during dependency injection declaration and can also be injected when retrieved from the dependency injection container.
            prop: 'testValue'
        }
    }
}).then(async (app: Application) => {
    const subScope: Container = app.createScope()
    const example = await subScope.get<ExampleObject>('example', {prop: 'overrideValue'})
    //The init method in the ExampleObject class has been executed at this point.
    app.log.info(example.prop)//The value output here will be "overrideValue".
    await subScope.destroy()
    //The destroy method in the ExampleObject class has been executed at this point.
}).catch(error => Logger.error(error))
```

In the above example, we created a subclass ExampleObject that inherits from BaseObject and set its lifecycle mode as
Scoped. After obtaining an instance of this class using a child dependency injection container and subsequently
destroying that container, the lifecycle of ExampleObject within the child container has ended.
