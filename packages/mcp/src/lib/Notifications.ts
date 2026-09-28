/**
 * Where the notifications of the application go: an adapter while it runs
 */
export type MCPNotificationSink = {
    toolsChanged(): void
    promptsChanged(): void
    resourcesChanged(): void
    resourceUpdated(uri: string): void
}

/**
 * The sinks of the adapters running
 */
const sinks: Set<MCPNotificationSink> = new Set()

/**
 * Send the notifications to a sink until the returned function is called
 * @param sink
 */
export function AddNotificationSink(sink: MCPNotificationSink): () => void {
    sinks.add(sink)
    return (): void => void sinks.delete(sink)
}

/**
 * Send a notification to the sinks
 * @param send
 */
export function Notify(send: (sink: MCPNotificationSink) => void): void {
    sinks.forEach(send)
}
