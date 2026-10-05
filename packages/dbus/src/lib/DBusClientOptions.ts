import type {DecodeOpts} from 'dbus-sdk'

/**
 * The options of {@link BuildDBusClientOptions}: the bus a {@link DBusClientComponent} connects to, and how it decodes
 * the replies.
 */
export interface DBusClientOptions {
    /**
     * The address of the bus: `'unix:path=/var/run/dbus/system_bus_socket'` (the system bus),
     * `'unix:path=/run/user/1000/bus'`, `'tcp:host=127.0.0.1,port=5555'`; the value of `DBUS_SESSION_BUS_ADDRESS` for
     * the session bus.
     */
    busAddress: string
    /**
     * How long the connection to the bus may take, in milliseconds (a positive integer).
     * @default 20000
     */
    timeout?: number
    /**
     * How long a call may wait for its reply, in milliseconds (a positive integer); a call's own `timeout` overrides it.
     * @default dbus-sdk's default
     */
    callTimeout?: number
    /**
     * How the replies and the signals are decoded (`DecodeOpts` of `dbus-sdk`): `types` (`'none'`, `'variants'`,
     * `'all'`: where the values keep their D-Bus types as typed values), `dictionaries` (`'object'` or `'map'`),
     * `int64` (`'number'` or `'bigint'`).
     * @default {int64: 'number'} (the 64-bit integers as numbers when they are safe integers, else bigints)
     */
    decode?: DecodeOpts
}
