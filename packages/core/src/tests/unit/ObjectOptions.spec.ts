import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {Component} from '../../lib/core/Component.js'
import {Container} from '../../lib/core/Container.js'
import {Module} from '../../lib/core/Module.js'
import {Configurable} from '../../decorators/di/Configurable.js'
import {DTO} from '../../lib/dto/DTO.js'
import {ModuleOptions} from '../../options/ModuleOptions.js'
import {InvalidObjectOptionsException} from '../../exceptions/di/InvalidObjectOptionsException.js'

class BaseService extends Component {
    @Configurable(DTO.Boolean().optional().default(false))
    public readonly debug: boolean
}

class Service extends BaseService {
    @Configurable(DTO.String().valid('trace', 'info', 'error').optional().default('info'))
    public readonly level: string

    @Configurable(DTO.Number().integer().min(1).optional())
    public readonly port: number
}

class Channels extends Component {
    public static acceptsOption(name: string): boolean {
        return name.startsWith('channel.')
    }
}

/**
 * The validation of a value by an external rule fails, which only the asynchronous validation runs
 */
class Checked extends Component {
    @Configurable(DTO.String().optional().external(async (): Promise<never> => {
        throw new Error('rejected by the external rule')
    }))
    public readonly name: string
}

/**
 * Initialize a module of the given options: its initialization error and the warnings emitted while it initializes
 * @param options
 */
async function InitializeModule(options: ModuleOptions): Promise<{ module: Module, error?: Error, warnings: string[] }> {
    const warnings: string[] = []
    const listener = (warning: Error): number => warnings.push(warning.message)
    process.on('warning', listener)
    try {
        let module!: Module
        //The module given to its requester once initialized, its initialization error thrown: kept when it is created
        const error: Error | undefined = await new Container().set(class extends Module {
            protected options: ModuleOptions = options

            protected readonly created: boolean = ((): boolean => {
                module = this
                return true
            })()
        }).then((): undefined => undefined, (error: Error): Error => error)
        return {module: module, error: error, warnings: warnings}
    } finally {
        process.off('warning', listener)
    }
}

describe('The check of the options of the declared objects', (): void => {

    //Node prints the warnings: the tests keep its output clean
    const printers: NodeJS.WarningListener[] = []

    before((): void => {
        printers.push(...process.listeners('warning'))
        process.removeAllListeners('warning')
    })

    after((): void => printers.forEach((printer: NodeJS.WarningListener): unknown => process.on('warning', printer)))

    it('accepts the valid options, the inherited configurable properties and the options of the declarations', async (): Promise<void> => {
        const {error, warnings} = await InitializeModule({
            components: {service: {class: Service, level: 'error', port: 8080, debug: true, id: 'ignored'}},
            objects: {anonymous: [{class: Service, port: undefined}]}
        })
        assert.strictEqual(error, undefined)
        assert.deepStrictEqual(warnings, [])
    })

    it('fails on the invalid values of the objects never created, listing them all', async (): Promise<void> => {
        const {module, error} = await InitializeModule({
            components: {
                first: {class: Service, level: 'verbose'},
                second: {class: Service, port: 0, debug: 'yes'}
            }
        })
        assert.ok(error instanceof InvalidObjectOptionsException)
        assert.deepStrictEqual(error.message.split('\n'), [
            'The option "level" of "first" (Service) is invalid: "level" must be one of [trace, info, error]',
            'The option "port" of "second" (Service) is invalid: "port" must be greater than or equal to 1',
            'The option "debug" of "second" (Service) is invalid: "debug" must be a boolean'
        ])
        //No object was loaded
        assert.strictEqual(await module.getObject('first').then((): boolean => true, (): boolean => false), false)
    })

    it('warns of the options which are not configurable properties, unless the class accepts them', async (): Promise<void> => {
        const {module, error, warnings} = await InitializeModule({
            components: {
                service: {class: Service, levle: 'error'},
                channels: {class: Channels, 'channel.http': {}, chanel: {}}
            },
            objects: {anonymous: [{class: Channels, other: 1}]}
        })
        assert.strictEqual(error, undefined)
        assert.deepStrictEqual(warnings, [
            //The anonymous objects are declared first
            'The option "other" of Channels is not a configurable property, it is ignored (its configurable properties: maxListeners)',
            'The option "levle" of "service" (Service) is not a configurable property, it is ignored (its configurable properties: debug, level, maxListeners, port)',
            'The option "chanel" of "channels" (Channels) is not a configurable property, it is ignored (its configurable properties: maxListeners)'
        ])
        assert.strictEqual((await module.getObject<Service>('service')).level, 'info')
    })

    it('leaves the values validated by external rules to the objects', async (): Promise<void> => {
        const {module, error} = await InitializeModule({components: {checked: {class: Checked, name: 'value'}}})
        assert.strictEqual(error, undefined)
        await assert.rejects(module.getObject('checked'), /rejected by the external rule/)
    })

    it('does not check the options when the module disables the check', async (): Promise<void> => {
        const {module, error, warnings} = await InitializeModule({
            checkOptions: false,
            components: {service: {class: Service, level: 'verbose', levle: 'error'}}
        })
        assert.strictEqual(error, undefined)
        assert.deepStrictEqual(warnings, [])
        await assert.rejects(module.getObject('service'), /"level" must be one of/)
    })
})
