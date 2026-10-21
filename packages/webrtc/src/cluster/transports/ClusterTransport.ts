/**
 * The bus under a cluster: subjects that every subscriber receives the messages of, in the order of each publisher
 */
export interface ClusterTransport {
    /**
     * The size of a message at most, in bytes: the larger ones are sent in parts
     */
    readonly maxPayload: number

    /**
     * Connect to the server
     */
    connect(): Promise<void>

    /**
     * Publish a message, without waiting; one that cannot be sent is lost
     * @param subject
     * @param data
     */
    publish(subject: string, data: Uint8Array): void

    /**
     * Receive the messages of a subject
     * @param subject
     * @param handler
     */
    subscribe(subject: string, handler: (data: Uint8Array) => void): Promise<void>

    /**
     * Call a listener each time the connection comes back after it was lost (the messages meanwhile may be lost)
     * @param listener
     */
    onReconnect(listener: () => void): void

    /**
     * Close the connection, once the messages published are sent
     */
    close(): Promise<void>
}
