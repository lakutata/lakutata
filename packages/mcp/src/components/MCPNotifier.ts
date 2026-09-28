import {Component} from '@lakutata/core'
import {Autoload, Singleton} from '@lakutata/core/decorator/di'
import {Notify} from '../lib/Notifications.js'

/**
 * Notify the MCP clients of the changes of the application, through the MCP adapters running:
 * inject it (@Inject(MCPNotifier)) or get it (getObject(MCPNotifier)) from any object
 */
@Autoload()
@Singleton()
export class MCPNotifier extends Component {

    /**
     * A resource changed: the clients which subscribed to its URI read it again
     * @param uri
     */
    public resourceUpdated(uri: string): void {
        Notify((sink): void => sink.resourceUpdated(uri))
    }

    /**
     * The list of the resources changed
     */
    public resourcesChanged(): void {
        Notify((sink): void => sink.resourcesChanged())
    }

    /**
     * The list of the tools changed
     */
    public toolsChanged(): void {
        Notify((sink): void => sink.toolsChanged())
    }

    /**
     * The list of the prompts changed
     */
    public promptsChanged(): void {
        Notify((sink): void => sink.promptsChanged())
    }
}
