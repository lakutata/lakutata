/**
 * The options of {@link buildDBusClientOptions}: the bus a {@link DBusClientComponent} connects to, and how it decodes
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
     * Return the replies as `dbus-sdk` typed values (`DBusSignedValue`) instead of plain JavaScript values.
     * @default false
     */
    advancedResponse?: boolean
    /**
     * Convert the 64-bit integers of the replies from `bigint` to `number`; the values beyond 2^53 lose precision.
     * @default true
     */
    convertBigIntToNumber?: boolean
}
