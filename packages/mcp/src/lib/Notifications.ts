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
 * The method of {@link MCPNotifier} attaching the sink of an adapter of its application
 */
export const ATTACH: unique symbol = Symbol('MCP.NOTIFIER.ATTACH')
