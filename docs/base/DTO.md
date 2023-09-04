## Description

In the Lakutata framework, DTO (Data Transfer Object) is a special base class that does not inherit from BaseObject. It
is used for data object validation and definition. The DTO base class includes a set of static methods for validation
purposes. DTO can be used in two ways.

The first way is bypassing an object parameter during the creation of a DTO instance for parameter validation. The
second way is by using the static methods of the DTO class to validate a specified object. If the validation is
successful, a DTO object with the instantiated data will be returned.

In the Lakutata framework, you can create a subclass that inherits from the DTO base class. The constructor of the
subclass can be used as a validator for method parameter validation. This allows for unified data definition and
validation using the DTO class.

## How to Use

First step, declare an ExampleDTO:

```typescript
import {DTO, Validator, Expect} from 'lakutata'

class ExampleDTO extends DTO {
    @Expect(Validator.String().required())
    public readonly id: string

    @Expect(Validator.String().required())
    public readonly username: string

    @Expect(Validator.Number().optional().default(0))
    public readonly age: number
}
```

Next, use the @Accept() decorator on the method that requires validation and pass the constructor of ExampleDTO as a
parameter to the decorator.

```typescript
import {Model, Accept} from 'lakutata'

class ExampleModel extends Model {
    @Accept(ExampleDTO)
    public async newUser(userInfo: ExampleDTO): Promise<any> {
        /**
         * The incoming user information will always contain id, username, and age.
         */
    }
}
```

Alternatively, another usage approach is to directly pass the object data as a parameter to the constructor of
ExampleDTO. In this case, the instantiated object will validate the passed data during the instantiation process.

```typescript
try {
    const user: ExampleDTO = new ExampleDTO({
        id: '86757',
        username: 'tester'
    })
} catch (e) {
    /**
     * If the data passed in cannot pass the data validation of the DTO, an error will be thrown.
     */
}
```
