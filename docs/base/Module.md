## Description

A module is an independent software unit within an application. A single module can contain a set of functionality units
such as models, components, and controllers. Think of a module as a separate sub-software within the application.
However, a module cannot run independently and must be attached to an application as its host. The application itself is
essentially a module, but it undergoes special handling compared to regular modules. Typically, a module should have its
own dedicated folder within the project, serving as the main folder for the module. The component, model, and other
functional classes used within the module should be stored in this folder.

By default, the module has a `Singleton` lifecycle, meaning that only one instance of the module is created and shared
throughout the application. This default lifecycle cannot be changed in the subclass of the module.

## How to Use

```typescript
import {Module, Configurable} from 'lakutata'

class ExampleModule extends Module {

    @Configurable()
    protected prop: any

    /**
     * Inline loading of configuration objects
     * @protected
     */
    protected async configure(): Promise<ModuleOptions<TModule> | undefined> {
        //If you need to inline load configuration objects, you will need to override this method in the subclass.
        return
    }

    /**
     * Automatic loading of an array collection of inline objects
     * @protected
     */
    protected async autoload(): Promise<(string | IConstructor<TBaseObject>)[]> {
        return []
    }

    /**
     * Inline loading of an array collection of controllers
     * @protected
     */
    protected async controllers(): Promise<(string | IConstructor<TController>)[]> {
        return []
    }

    /**
     * Inline loading of component configuration
     * @protected
     */
    protected async components(): Promise<Record<string, IConstructor<TComponent> | LoadComponentOptions<TComponent>>> {
        return {}
    }

    /**
     * Inline loading of module configuration
     * @protected
     */
    protected async modules(): Promise<Record<string, IConstructor<TModule> | LoadModuleOptions<TModule>>> {
        return {}
    }

    /**
     * Inline loading of bootstrap configuration
     * @protected
     */
    protected async bootstrap<U extends Module>(): Promise<(string | IConstructor<TModule> | AsyncFunction<U, void>)[]> {
        return []
    }
}
```

Once you have written ExampleModule, you can configure the main application to load this module.

```typescript
import {Application} from 'lakutata'

Application.run({
    /*** Other Configurations ***/
    modules: {
        example: {
            class: ExampleModule,
            prop: 'example'
        }
    },
    bootstrap: [
        /**
         * This is crucial, as you must declare the module in the bootstrap configuration in order for it to be loaded and initialized. Failing to do so will result in the module not being started.
         */
        'example'
    ]
})
```
