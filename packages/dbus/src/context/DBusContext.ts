import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {BaseContext} from '@lakutata/entrypoint'
import {type DBusContextParams} from '../types/DBusContextParams.js'

/**
 * The type of the DBus contexts
 */
export const DBUS_CONTEXT_TYPE: string = 'DBUS'

export class DBusContext<T extends Record<string, any> = {}> extends BaseContext<T> {

    @Expect(DTO.String().valid(DBUS_CONTEXT_TYPE).default(DBUS_CONTEXT_TYPE))
    public readonly type: string

    /**
     * The path of the object called
     */
    @Expect(DTO.String().required())
    public readonly path: string

    /**
     * The interface of the method called
     */
    @Expect(DTO.String().required())
    public readonly interface: string

    /**
     * The name of the method called
     */
    @Expect(DTO.String().required())
    public readonly member: string

    constructor(params: DBusContextParams) {
        super(params)
    }
}
