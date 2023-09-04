## Description

The model is a part of the MVC (Model-View-Controller) pattern and represents objects that hold business data, rules,
and logic. It inherits from the Component class, and in addition to the base functionality provided by Component,
changes in the properties of the Model will trigger a 'property-changed' event. In usage, subclasses of Model can be
automatically loaded through the 'autoLoad' configuration in the application or accessed by name in the 'entries'
configuration.

By default, the lifecycle mode of Model is `Scoped`.

## How to Use

```typescript
import {Application, Model, Configurable, Scoped} from 'lakutata'

@Scoped()
class ExampleModel extends Model {
    @Configurable()
    public prop: any

}

Application.run({
    /*** Other Configurations ***/
    autoLoad: [ExampleModel]
}).then(async (app: Application) => {
    const example: ExampleModel = await app.get(ExampleModel, {prop: 'abc'})
    example.on('property-changed', (propertyKey: string, newValue: any, oldValue: any) => {
        app.log('property %s changed, from %s to %s', propertyKey, oldValue, newValue)
    })
    example.prop = 'efg'
}).catch(error => Logger.error(error))
```
