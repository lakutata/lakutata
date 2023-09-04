## Description

In the Lakutata framework, it supports defining paths in the form of aliases to simplify the handling logic of paths.
Alias declaration needs to be done during the program startup by specifying aliases in the application startup
configuration. Once declared, can be used throughout the program runtime.
When using aliases, it is important to note that any defined alias must start with the `@` symbol.

The framework has pre-defined the alias "@app" during startup, which represents the path where the program entry script
is located. When declaring other aliases, you can also use this predefined alias as part of the path.

    {"@test":"@app/test"}

## How to Use

Firstly, let's declare the aliases.

```typescript
import {Application} from 'lakutata'

Application.run({
    /*** Other Options ***/
    alias: {
        '@data': '@app/data',
        '@controllers': '@app/controllers',
        '@models': '@app/models'
    }
})
```

Once the aliases are declared, they can be used in the program. When using the path module in Node.js, you can resolve
the real path represented by the alias using

    path.resolve('@data', './test.file')

Additionally, the autoload and controllers loading configurations in the application also support the use of aliases.
