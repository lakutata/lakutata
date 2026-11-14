# Lakutata Modules

A **module** is a component that declares its own components, providers and objects, as the application does. A
module's objects resolve their dependencies in the module first, then in the application; the application's other
objects cannot inject them, and reach the feature through the module itself. This guide describes declaring a module,
how its objects are resolved, its creation, configuring it from the application, and when to use one. `Module` and
`ModuleOptions` are exported by `lakutata`.

## 1. Declaring a module

A module extends `Module` and specifies its declarations in the initializer of its `options` property. These options
have the same form as an application's options: `components`, `providers`, `objects`, `bootstrap` and
`checkOptions`.

```typescript
import {Application, Component, type ILogger, Module, type ModuleOptions} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'

//The objects of the module
class Gateway extends Component {
    public async charge(amount: number): Promise<string> {
        return `${amount} charged`
    }
}

class Payments extends Component {
    //Declared by the module
    @Inject('gateway')
    protected readonly gateway: Gateway

    //Not declared by the module: found in the application
    @Inject('log')
    protected readonly log: ILogger

    public async pay(amount: number): Promise<string> {
        const receipt: string = await this.gateway.charge(amount)
        this.log.info('Payment: %s', receipt)
        return receipt
    }
}

//The module declares its objects in the initializer of its options, as an application does
export class PaymentModule extends Module {
    protected options: ModuleOptions = {
        components: {
            gateway: {class: Gateway},
            payments: {class: Payments}
        },
        bootstrap: ['gateway']
    }

    //The methods the rest of the application calls
    public async pay(amount: number): Promise<string> {
        const payments: Payments = await this.getObject<Payments>('payments')
        return await payments.pay(amount)
    }
}

//An object of the application: it injects the module, not the objects inside it
class Checkout extends Component {
    @Inject('payment')
    protected readonly payment: PaymentModule

    public async checkout(amount: number): Promise<string> {
        return await this.payment.pay(amount)
    }
}

Application
    .run(() => ({
        id: 'shop.app',
        name: 'Shop',
        components: {
            checkout: {class: Checkout}
        },
        objects: {
            named: {
                payment: {class: PaymentModule}
            }
        },
        bootstrap: ['payment']
    }))
    .onLaunched(async (app: Application, log: ILogger): Promise<void> => {
        const checkout: Checkout = await app.getObject<Checkout>('checkout')
        log.info('Checkout: %s', await checkout.checkout(42))
    })
```

```text
INFO (Shop/…): Payment: 42 charged
INFO (Shop/…): Checkout: 42 charged
```

- The application declares a module in `objects.named`. When a module is declared in `components`, the launch
  fails with an `InvalidObjectTypeException`, whose message points to `objects.named`.
- `bootstrap: ['payment']` creates the module at launch; otherwise it is created when an object first requests it. The
  module's own `bootstrap` then creates its objects in order, as the application's does.
- A module is a singleton, and its lifetime is locked. It is a component, so it has a component's events and methods,
  and its `getObject()` is public: code outside the module can obtain one of the module's objects through it.

## 2. How the objects of a module are resolved

- **Inside the module**, a name is looked up in the module first, then in the application: `Payments` finds `gateway`
  in the module, and `log` in the application. A name the module declares hides the same name in the application for
  the module's objects.
- **Outside the module**, the application's objects see only the module: `app.getObject('gateway')` fails, and
  creating an application object that injects `gateway` fails with a `DependencyInjectionException`.
- **The module itself** is visible to its objects: they can inject it by name (`@Inject('payment')`), and
  `this.getModule()` returns it.
- **An application singleton** stays in the application: when an object in the module obtains one, it receives the
  application's instance, whose dependencies are resolved in the application.

## 3. Creation and teardown

When the module is created, its declarations are registered and its options are checked, as the application checks its
own; its `bootstrap` steps then run in order. Its own `init()` and `startup()` run after its bootstrap, so a bootstrap
step must not depend on work done in the module's `init()`.

An object outside the module that requests it waits until the module's bootstrap has completed, and receives the
error of a step that fails; for the application, the launch fails with such an error. The module's objects, which its
bootstrap creates, receive the module immediately, which is why they can inject it. The module is destroyed with the
container that created it, and its objects with it.

## 4. Configuring a module from the application

A module's declaration accepts an `options` option, merged over the module's initializer:

```typescript
objects: {
    named: {
        payment: {
            class: PaymentModule,
            //A component of the same name replaces the one of the initializer
            options: {components: {gateway: {class: TestGateway}}}
        }
    }
}
```

- A component or provider declared under the name of one in the initializer replaces it; a declaration without
  `class` completes the options of the one in the initializer.
- The `bootstrap` steps are appended to the initializer's steps.
- `checkOptions` set here overrides the initializer's value.

An application, or a test, can therefore replace an object inside a module without changing the module.

## 5. When to use a module

A module suits a feature made of several objects that the rest of the application should reach only through one object:
the module keeps the feature's objects out of the application's names, and provides one place for the feature's
declarations. A feature that consists of one object is a component; to share such a component between applications,
a package exports it with a function that builds its declaration ([Dependency Injection](Injection.md), section 3).
