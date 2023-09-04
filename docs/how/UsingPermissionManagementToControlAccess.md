## Description

In the Lakutata framework, the permission management feature is integrated using Casbin. By adding the `@Action()`
decorator to methods in the Controller, you can add interface authentication parameters. During program startup, the
interface permission data is updated. The framework has an embedded AccessControl component, which is loaded with the
name `access` within the framework. By manipulating this component, you can grant and modify permissions for users and
roles. However, it is important to note that when using access control, the loading parameters of the Controller must
include the `user` field. Otherwise, an error will occur during authentication.

## How to Use

To use AccessControl, it is necessary to configure the data storage of AccessControl in the program startup
configuration. Without this configuration, AccessControl will not function properly.

```typescript
import {Application, AccessControl} from 'lakutata'

Application.run({
    components: {
        access: {
            class: AccessControl,
            store: {
                /**
                 * Here, you can use the DataSourceOptions of TypeORM or choose to store the data in a file. When using file storage, you need to set the "type" property to "file" and specify the "filename" field to indicate the storage location of the file.
                 */
            }
        }
    }
})
```

Once the storage configuration for AccessControl is completed, you can proceed with the implementation of the
authentication logic code.

First, you need to declare the interface that requires authentication and provide the authentication information within
the Controller.

```typescript
import {Action, Controller} from 'lakutata'

export class MathController extends Controller {
    /**
     * Controller action using access control
     * @param inp
     */
    @Action({ctrl: 'math', act: 'add'}, {name: 'add', operation: 'execute'})
    public async add(inp: { a: number, b: number }): Promise<number> {
        return inp.a + inp.b
    }

}
```

After declaring the interfaces that require authorization, you can use the `listAllPermissions` method of the `access`
object to obtain the declared authorization interface information in the program.

```typescript
const access: AccessControl = await app.get<AccessControl>('access')
access.listAllPermissions()//This will return the information of all authorization interfaces in the program
```

If you need to access an interface that has access control enabled, you will need to grant authorization to the user
attempting to access it. Otherwise, the user will receive an error indicating insufficient access privileges when
attempting to access the interface.

```typescript
//The usage of configurable parameters is necessary in this instance to pass user information and obtain an instance of AccessControl. Otherwise, it will not be possible to set user permissions.
const access: AccessControl = await app.get<AccessControl>('access', {
    //The user object must fulfill the interface definition of IUser.
    user: {id: '89757', username: 'robot1'}
})
//Grant the interface named 'execute' with the permission 'add' to the user currently performing the authorized operation.
await accessControl.createUserPermission('add', 'execute')
```

At this point, the user should have been granted access to the interface, and they can now retrieve the execution
results of the interface when accessing it.
