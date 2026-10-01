/**
 * The parameters of the context of the D-Bus method calls (DBusContext)
 */
export type DBusContextParams = {
    readonly path: string
    readonly interface: string
    readonly member: string
    readonly data: Record<string, any>
}
