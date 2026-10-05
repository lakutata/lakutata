import {Controller, type ControllerProperty} from '../lib/Controller.js'
import {MethodDecorator, DTO} from '@lakutata/core'
import {RegisterCLIAction} from '../lib/ControllerEntrypoint.js'
import {ActionOptions} from '../lib/ActionOptions.js'
import {getActionDTOAndOptions} from '../lib/GetActionDTOAndOptions.js'
import {CLIContext} from '../context/CLIContext.js'

/**
 * Expose the controller method as a CLI command, run by the CLI adapters of the entrypoint (`commanderCLIEntrypoint`).
 * Without a DTO, the command has no options and its input is accepted as it is.
 * On a command, the CLI adapter (`commanderCLIEntrypoint`) assembles the input from the positional arguments and the
 * options, each value parsed by the type of its property; the middlewares run, the input is validated against the DTO
 * (the defaults applied), the access control runs when `acl` is set, then the method receives the validated input as a
 * plain object.
 * The value returned is written to stdout: a string as it is, a `Uint8Array` as its bytes, `undefined` and `null` as
 * nothing, another value as indented JSON; `Result.file()` and `Result.events()` stream a file or events. An error is
 * written to stderr as `error: <errMsg or message>` and the command ends with the code 1.
 * @param command The command line: its name, optionally followed by positional arguments (`copy <source> [target]`,
 * `<files...>` for several values) given to the input properties of the same names; the words before the name are
 * groups (`package exe <file>`: the command `exe` of the group `package`). The controller's `@Prefix({command})` is
 * prepended to it, joined by ":" (`user` and `get` give `user:get`).
 * @returns The method decorator.
 * @example
 * ```typescript
 * import {Application, DTO} from 'lakutata'
 * import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
 * import {CLIAction} from 'lakutata/decorator/ctrl'
 * import {Expect} from 'lakutata/decorator/dto'
 * import {commanderCLIEntrypoint} from 'lakutata/adapter/commander'
 *
 * class GreetDTO extends DTO {
 *     //The positional argument <name>
 *     @Expect(DTO.String().required().description('Who to greet'))
 *     public name!: string
 *
 *     //The option --times <value>, parsed as a number
 *     @Expect(DTO.Number().integer().min(1).optional().default(1).description('How many times'))
 *     public times!: number
 *
 *     //The flag --shout
 *     @Expect(DTO.Boolean().optional().default(false).description('Greet loudly'))
 *     public shout!: boolean
 * }
 *
 * class GreetController extends Controller {
 *     //"app greet Ada --times 2 --shout" prints ["HELLO, ADA", "HELLO, ADA"] as JSON; "app greet Ada --times 0" prints
 *     //"error: …" to stderr and ends with the code 1
 *     @CLIAction('greet <name>', GreetDTO, {description: 'Greet someone'})
 *     public async greet(input: GreetDTO): Promise<string[]> {
 *         const text: string = `Hello, ${input.name}`
 *         return Array(input.times).fill(input.shout ? text.toUpperCase() : text)
 *     }
 * }
 *
 * Application.run(() => ({
 *     id: 'greet.app',
 *     name: 'Greet',
 *     components: {
 *         entrypoint: buildEntrypoints({
 *             controllers: [GreetController],
 *             cli: commanderCLIEntrypoint()
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * }))
 * ```
 */
export function CLIAction<ClassPrototype extends Controller, Method>(command: string): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Expose the controller method as a CLI command whose options are the properties of a DTO. The CLI adapter assembles
 * the input from the positional arguments and the options; the method receives it validated, as a plain object. The
 * value returned is written to stdout (a string as it is, another value as JSON), an error to stderr as `error:
 * <message>` with the exit code 1.
 * @param command The command line: its name, optionally followed by positional arguments (`copy <source> [target]`,
 * `<files...>` for several values) given to the input properties of the same names; the words before the name are
 * groups (`package exe <file>`: the command `exe` of the group `package`). The controller's `@Prefix({command})` is
 * prepended to it, joined by ":" (`user` and `get` give `user:get`).
 * @param dtoConstructor The DTO class of the input: each of its properties not given by a positional argument is an
 * option `--kebab-case-name` (a flag for a boolean, a repeatable option for an array, JSON for an object), mandatory
 * when it is required without a default; its schema `.description()` is the option's help.
 * @returns The method decorator.
 */
export function CLIAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(command: string, dtoConstructor: DTOConstructor): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Expose the controller method as a CLI command, with action options; the command has no options and its input is
 * accepted as it is. The value returned is written to stdout (a string as it is, another value as JSON), an error to
 * stderr as `error: <message>` with the exit code 1.
 * @param command The command line: its name, optionally followed by positional arguments (`copy <source> [target]`,
 * `<files...>` for several values) given to the input properties of the same names; the words before the name are
 * groups (`package exe <file>`: the command `exe` of the group `package`). The controller's `@Prefix({command})` is
 * prepended to it, joined by ":" (`user` and `get` give `user:get`).
 * @param actionOptions The action options: `description` is the command's help; `acl` runs the access control rules
 * (false by default); `name` (unique in the CLI actions, `ClassName:method` by default) and `groups` describe the
 * action; `rule` is an access rule of the action; `middlewares` run before the ones `@UseMiddlewares` adds to the
 * method.
 * @returns The method decorator.
 * @throws {InvalidValueException} When the class is declared, if the action options are invalid.
 * @throws {InvalidMiddlewareException} When the class is declared, if a middleware of the options is neither a function
 * nor a class extending `Middleware`.
 */
export function CLIAction<ClassPrototype extends Controller, Method>(command: string, actionOptions: ActionOptions<CLIContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Expose the controller method as a CLI command whose options are the properties of a DTO, with action options. The CLI
 * adapter assembles the input from the positional arguments and the options; the method receives it validated, as a
 * plain object. The value returned is written to stdout (a string as it is, another value as JSON), an error to stderr
 * as `error: <message>` with the exit code 1.
 * @param command The command line: its name, optionally followed by positional arguments (`copy <source> [target]`,
 * `<files...>` for several values) given to the input properties of the same names; the words before the name are
 * groups (`package exe <file>`: the command `exe` of the group `package`). The controller's `@Prefix({command})` is
 * prepended to it, joined by ":" (`user` and `get` give `user:get`).
 * @param dtoConstructor The DTO class of the input: each of its properties not given by a positional argument is an
 * option `--kebab-case-name` (a flag for a boolean, a repeatable option for an array, JSON for an object), mandatory
 * when it is required without a default; its schema `.description()` is the option's help.
 * @param actionOptions The action options: `description` is the command's help; `acl` runs the access control rules
 * (false by default); `name` (unique in the CLI actions, `ClassName:method` by default) and `groups` describe the
 * action; `rule` is an access rule of the action; `middlewares` run before the ones `@UseMiddlewares` adds to the
 * method.
 * @returns The method decorator.
 * @throws {InvalidValueException} When the class is declared, if the action options are invalid.
 * @throws {InvalidMiddlewareException} When the class is declared, if a middleware of the options is neither a function
 * nor a class extending `Middleware`.
 */
export function CLIAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(command: string, dtoConstructor: DTOConstructor, actionOptions: ActionOptions<CLIContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>

export function CLIAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(command: string, dtoConstructorOrOptions?: DTOConstructor | ActionOptions<CLIContext>, options?: ActionOptions<CLIContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>> {
    return (target: ClassPrototype, propertyKey: ControllerProperty<ClassPrototype>, descriptor: TypedPropertyDescriptor<Method>): TypedPropertyDescriptor<Method> => {
        const [dtoConstructor, actionOptions] = getActionDTOAndOptions(dtoConstructorOrOptions, options)
        RegisterCLIAction(command, target, propertyKey, dtoConstructor, ActionOptions.validate(actionOptions))
        return descriptor
    }
}
