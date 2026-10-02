// Type safety fixture: the configurations and the calls of the applications which the IDE checks (as 2.x does), so a
// mistake is a compile error, not a runtime error. The correct usages compile, each mistake is an expected error: a
// change making a mistake compile (an "Unused '@ts-expect-error'" error) loses a check. Run via: npm run test:types
//
// Known gaps, not checked in 2.x either: a component declared as a provider (Component extends Provider), an
// unknown property of a DTO (DTO has an index signature).
import {Application, Component, Provider, DTO, BaseObject} from 'lakutata'
import {BuildEntrypoints, BuildHTTPEntrypoint, Controller} from 'lakutata/com/entrypoint'
import {BuildDatabaseOptions} from 'lakutata/com/database'
import {Logger} from 'lakutata/com/logger'
import {Expect} from 'lakutata/decorator/dto'
import {BuildI18nOptions, type I18n} from 'lakutata/com/i18n'

class MyComponent extends Component {
    public hello(): string {
        return 'hello'
    }
}

class MyProvider extends Provider {
    public world(): number {
        return 1
    }
}

class MyController extends Controller {
}

class NotBaseObject {
    public x: number = 1
}

class MyDTO extends DTO {
    @Expect(DTO.String().required())
    public name!: string
}

//The correct configuration: no error
Application
    .env({NODE_ENV: 'production'})
    .alias({'@data': '/tmp/data'}, true)
    .run(async () => ({
        id: 'app.id',
        name: 'App',
        timezone: 'Asia/Shanghai',
        mode: 'production' as const,
        components: {
            log: {class: Logger},
            my: {class: MyComponent},
            db: BuildDatabaseOptions({type: 'mysql', host: 'localhost', database: 'test'}),
            entrypoint: BuildEntrypoints({controllers: [MyController]})
        },
        providers: {
            mine: {class: MyProvider}
        },
        bootstrap: ['log', MyComponent, async (app): Promise<void> => void app]
    }))
    .onLaunched(async (app: Application, log: Logger): Promise<void> => {
        log.info('launched')
        const my: MyComponent = await app.getObject(MyComponent)
        my.hello()
        const named: MyComponent = await app.getObject<MyComponent>('my')
        named.hello()
        new MyDTO({name: 'x'})
    })

//The mistakes
// @ts-expect-error E01 id is a number
Application.run({id: 1, name: 'App'})
// @ts-expect-error E02 id is missing
Application.run({name: 'App'})
// @ts-expect-error E03 an option of the database is misspelled
Application.run({id: 'a', name: 'b', components: {db: BuildDatabaseOptions({type: 'mysql', host: 'h', databasee: 'x'})}})
// @ts-expect-error E04 an unknown database type
Application.run({id: 'a', name: 'b', components: {db: BuildDatabaseOptions({type: 'mysqlx'})}})
// @ts-expect-error E05 a provider declared as a component
Application.run({id: 'a', name: 'b', components: {x: {class: MyProvider}}})
// @ts-expect-error E07 a class which is not a BaseObject
Application.run({id: 'a', name: 'b', components: {x: {class: NotBaseObject}}})
// @ts-expect-error E08 a bootstrap item which is a number
Application.run({id: 'a', name: 'b', bootstrap: [123]})
// @ts-expect-error E09 an unknown mode
Application.run({id: 'a', name: 'b', mode: 'dev'})
// @ts-expect-error E10 a value of an environment variable which is a number
Application.env({A: 1})
// @ts-expect-error E11 a method of the logger misspelled
Application.run({id: 'a', name: 'b'}).onLaunched((app: Application, log: Logger): void => log.infoo('x'))
Application.run({id: 'a', name: 'b'}).onLaunched(async (app: Application): Promise<void> => {
    // @ts-expect-error E12 a method of an object got by its class misspelled
    (await app.getObject(MyComponent)).helo()
})
// @ts-expect-error E13 a controller which is not a controller
BuildEntrypoints({controllers: [MyComponent]})
// @ts-expect-error E14 a controller which is not a class
BuildEntrypoints({controllers: ['MyController']})
// @ts-expect-error E16 a component class which is not a class
Application.run({id: 'a', name: 'b', components: {x: {class: 'MyComponent'}}})
export const unused: BaseObject | undefined = undefined
// @ts-expect-error E17 a channel misspelled
BuildEntrypoints({controllers: [MyController], htpp: BuildHTTPEntrypoint((): void => undefined)})
// @ts-expect-error E18 a channel which is a number
BuildEntrypoints({controllers: [MyController], http: 123})
// @ts-expect-error E19 a rule which is a number
BuildEntrypoints({controllers: [MyController], rules: [123]})
// @ts-expect-error E20 an option of the entrypoint misspelled
BuildEntrypoints({controllers: [MyController], controlers: [MyController]})

//The keys of the messages declared by the application: a key misspelled, an argument missing or of another type
declare module 'lakutata/com/i18n' {
    interface I18nMessages {
        'order.count': { count: number }
    }
}
declare const i18n: I18n
i18n.t('order.count', {count: 1}, 'zh-CN')
i18n.translator('zh-CN').t('order.count', {count: 2})
// @ts-expect-error E21 a key of the messages misspelled
i18n.t('order.cuont', {count: 1})
// @ts-expect-error E22 an argument of a message missing
i18n.translator('zh-CN').t('order.count', {})
// @ts-expect-error E23 an argument of a message of another type
i18n.t('order.count', {count: 'many'})
// @ts-expect-error E24 an option of the i18n component misspelled
BuildI18nOptions({directroy: '@locales'})
