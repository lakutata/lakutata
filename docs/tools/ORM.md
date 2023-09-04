## Description

The ORM module has introduced [TypeORM](https://typeorm.io/). All the methods and decorators available in TypeORM can be
invoked in the ORM
module. The specific implementation of the ORM module in the framework is the Database component. TypeORM is integrated
into the Lakutata framework through the Database component. Here is an example of how to use the Database component:

```typescript
import {Application, Database} from 'lakutata'

Application.run({
    components: {
        db: {
            class: Database,
            options: {
                /** Here is the database connection parameters for TypeORM **/
            }
        }
    }
})
```
