/**
 * The base of the exceptions of the package: catch it for any of them. Its `errno` is the code of the error of the
 * system (`'EADDRINUSE'`, `'EACCES'`…) when the system refused something, `'E_NETIF'` for an error of the package, the
 * one of the subclass otherwise; its `name` is the name of its class.
 */
export class NetIfException extends Error {
    /**
     * `'E_NETIF'`, the code of the error of the system, or the one of the subclass.
     */
    public errno: string | number = 'E_NETIF'

    /**
     * An exception of a message.
     * @param message The message.
     * @param options The error that caused it (`cause`).
     */
    constructor(message?: string, options?: ErrorOptions) {
        super(message, options)
        this.name = new.target.name
    }
}
