## Description

Although the Lakutata framework does not explicitly include the View layer in its core code, it is designed and
implemented following the MVC architecture. The Controller in the framework is responsible for providing entry points
for functionality calls from the upper layers. The Controller itself adopts the Patrun invocation style. For different
upper-layer calls, requests can be organized as Pattern objects to perform functionality lookup and invocation on the
registered Controllers in the program. This approach ensures a generic Controller layer while providing good
accessibility for various invocation methods.

It is worth noting that each time a Controller is invoked, a child container is created. This child container will be
automatically destroyed after the method called by the Controller is executed. According to the lifecycle mechanism in
the Lakutata framework, objects injected and called within the Controller with a Scoped lifecycle will be destroyed
along with the container after a single request is completed. In the case of concurrent calls, different requests
calling the Controller belong to different child containers. Therefore, the contextual data of different requests within
the Controller is unique for each individual call.

By default, the lifecycle mode of the Controller is `Scoped`, and this lifecycle mode is locked and cannot be changed in
subclasses.

## How to Use

### Basic example

```typescript
import {Controller, Action} from 'lakutata'

class ExampleController extends Controller {

    @Action({
        ctrl: 'example',
        act: 'dosomething'
    })
    public async dosomething(inp): Promise<any> {
        return await someFunction(inp.a, inp.b, inp.c)
    }

}
```

### Example with permission verification

```typescript
import {Controller, Action} from 'lakutata'

class ExampleController extends Controller {

    @Action({
        ctrl: 'example',
        act: 'dosomething'
    }, {
        //Name of the action in permission management
        name: 'DoSomethingForMe',
        //Defining the operation of an action in permission management
        operation: 'execute',
        //Domain of permission management, options to obtain the name of the domain from the input object or use a fixed domain name, with the default domain name being "default"
        domain: (inp) => inp.domain
    })
    public async dosomething(inp): Promise<any> {
        return await someFunction(inp.a, inp.b, inp.c)
    }

}
```
