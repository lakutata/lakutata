import {DTO, Exception} from '@lakutata/core'
import {Expect, Return} from '@lakutata/core/decorator/dto'
import {Controller} from '@lakutata/entrypoint'
import {DBusContext, DBusInterface, DBusMethod, DefineDBusProperty, DefineDBusSignal} from '../../exports/DBus.js'

export class DeviceDTO extends DTO {
    @Expect(DTO.String().required())
    public sn: string

    @Expect(DTO.Number().integer().min(0).optional())
    public retries?: number
}

export class StatusDTO extends DTO {
    @Expect(DTO.String().required())
    public sn: string

    @Expect(DTO.Boolean().required())
    public online: boolean

    @Expect(DTO.Number().integer().optional())
    public retries?: number
}

export class OfflineException extends Exception {
    public errno: string = 'E_OFFLINE'
}

export const DeviceChanged = DefineDBusSignal('Changed', StatusDTO)

export const DeviceState = DefineDBusProperty<string>('State', 's', {initial: 'idle'})

export const DeviceLevel = DefineDBusProperty<number>('Level', 'i', {writable: true, initial: 1, schema: DTO.Number().integer().min(0).max(10)})

/**
 * The contexts seen by the methods
 */
export const contexts: DBusContext[] = []

@DBusInterface('com.example.Manager', {path: '/com/example/Manager'})
export class ManagerController extends Controller {

    @DBusMethod('Ping', {returns: 's'})
    public async ping(): Promise<string> {
        contexts.push(this.context as DBusContext)
        return 'pong'
    }

    @DBusMethod('Configure', DeviceDTO)
    @Return(StatusDTO)
    public async configure(input: DeviceDTO): Promise<StatusDTO> {
        return {sn: input.sn, online: true, retries: input.retries} as StatusDTO
    }

    @DBusMethod('Reset')
    public async reset(): Promise<void> {
    }

    @DBusMethod('Slow', {returns: 's'})
    public async slow(): Promise<string> {
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 150))
        return 'slow'
    }
}

@DBusInterface('com.example.Device', {path: '/com/example/Devices/{sn}', signals: [DeviceChanged], properties: [DeviceState, DeviceLevel]})
export class DeviceController extends Controller {

    //The sn of the input is the one of the object path
    @DBusMethod('Status', DeviceDTO)
    @Return(StatusDTO)
    public async status(input: DeviceDTO): Promise<StatusDTO> {
        contexts.push(this.context as DBusContext)
        return {sn: input.sn, online: input.sn !== 'OFF'} as StatusDTO
    }

    @DBusMethod('Reboot', DeviceDTO)
    public async reboot(input: DeviceDTO): Promise<void> {
        if (input.sn === 'OFF') throw new OfflineException('The device {sn} is offline', {sn: input.sn})
    }
}
