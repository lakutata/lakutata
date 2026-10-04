/**
 * The parameters of a {@link DBusContext}: the adapter builds them for each method call it receives. An application
 * builds them only to create a context itself, in a test of a controller.
 */
export type DBusContextParams = {
    /**
     * The object path of the method call (`'/com/example/Devices/A1'`), the variables of its template resolved.
     */
    readonly path: string
    /**
     * The name of the interface called (`'com.example.Device'`).
     */
    readonly interface: string
    /**
     * The name of the method called (`'Status'`).
     */
    readonly member: string
    /**
     * The input of the call: the entries of its `a{sv}` dictionary, an empty object for a method without input.
     */
    readonly data: Record<string, any>
}
