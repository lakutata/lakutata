import {Component} from '@lakutata/core'
import {Autoload, Singleton} from '@lakutata/core/decorator/di'
import {ATTACH, type MCPNotificationSink} from '../lib/Notifications.js'

/**
 * Tell the MCP clients what changed in the application, through every MCP adapter of the application running (the
 * adapters of another application in the same process are not notified). Inject it (`@Inject(MCPNotifier)`) or get it
 * (`getObject(MCPNotifier)`) from any object: it is autoloaded, a singleton of the application, and needs no
 * registration.
 *
 * Over stdio, the client is notified (of a resource update, only when it subscribed to the resource with
 * `resources/subscribe`). Over HTTP, the clients of the revision 2026-07-28 listening for the change
 * (`subscriptions/listen`) are notified; the clients of 2025 are served without sessions and cannot be. The
 * notifications are sent in the background: their failures are ignored, and nothing is sent while no adapter runs.
 * @example
 * ```typescript
 * import {Component} from 'lakutata'
 * import {Inject} from 'lakutata/decorator/di'
 * import {MCPNotifier} from '@lakutata/mcp'
 *
 * export class DeviceWatcher extends Component {
 *     @Inject(MCPNotifier)
 *     protected readonly notifier: MCPNotifier
 *
 *     public statusChanged(sn: string): void {
 *         //The clients which subscribed to the resource read it again
 *         this.notifier.resourceUpdated(`device://${sn}/status`)
 *     }
 *
 *     public deviceAdded(): void {
 *         //The clients list the resources again
 *         this.notifier.resourcesChanged()
 *     }
 * }
 * ```
 */
@Autoload()
@Singleton()
export class MCPNotifier extends Component {

    readonly #sinks: Set<MCPNotificationSink> = new Set()

    /**
     * Send the notifications to an adapter of the application until the returned function is called
     * @param sink
     */
    public [ATTACH](sink: MCPNotificationSink): () => void {
        this.#sinks.add(sink)
        return (): void => void this.#sinks.delete(sink)
    }

    /**
     * Send a notification to the adapters
     * @param send
     */
    #notify(send: (sink: MCPNotificationSink) => void): void {
        this.#sinks.forEach(send)
    }

    /**
     * Tell the clients that a resource changed (`notifications/resources/updated`): the clients which subscribed to its
     * URI read it again.
     * @param uri The URI of the resource read by the clients (`'device://A1/status'`), not its template.
     */
    public resourceUpdated(uri: string): void {
        this.#notify((sink): void => sink.resourceUpdated(uri))
    }

    /**
     * Tell the clients that the list of resources changed (`notifications/resources/list_changed`): they list them
     * again.
     */
    public resourcesChanged(): void {
        this.#notify((sink): void => sink.resourcesChanged())
    }

    /**
     * Tell the clients that the list of tools changed (`notifications/tools/list_changed`): they list them again.
     */
    public toolsChanged(): void {
        this.#notify((sink): void => sink.toolsChanged())
    }

    /**
     * Tell the clients that the list of prompts changed (`notifications/prompts/list_changed`): they list them again.
     */
    public promptsChanged(): void {
        this.#notify((sink): void => sink.promptsChanged())
    }
}
