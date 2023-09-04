## Description

Although the Lakutata framework does not explicitly include the View layer in its core code, it is designed and
implemented following the MVC architecture. The Controller in the framework is responsible for providing entry points
for functionality calls from the upper layers. The Controller itself adopts the Patrun invocation style. For different
upper-layer calls, requests can be organized as Pattern objects to perform functionality lookup and invocation on the
registered Controllers in the program. This approach ensures a generic Controller layer while providing good
accessibility for various invocation methods.

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
