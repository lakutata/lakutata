/**
 * What the application uses of the API of NW.js (the global nw of its background script): https://docs.nwjs.io
 */
declare namespace nw {

    /**
     * A window of NW.js
     */
    interface Window {
        on(event: 'closed' | 'loaded' | 'focus' | 'blur' | 'minimize' | 'restore', listener: () => void): this
        removeAllListeners(event?: string): this
        show(): void
        focus(): void
        restore(): void
        /**
         * Close the window: with true, without its close event
         * @param force
         */
        close(force?: boolean): void
    }

    /**
     * The options of a window: https://docs.nwjs.io/References/Manifest%20Format/#window-subfields
     */
    interface WindowOptions {
        title?: string
        width?: number
        height?: number
        icon?: string
        show?: boolean
        [option: string]: unknown
    }

    const App: {
        /**
         * The arguments of the application, after the directory of the application
         */
        readonly argv: string[]
        /**
         * Quit the application
         */
        quit(): void
        /**
         * A second instance of the application started: its command line given to the first one
         * @param event
         * @param listener
         */
        on(event: 'open', listener: (commandLine: string) => void): void
    }

    const Window: {
        /**
         * Open a window: its URL relative to the directory of the application
         * @param url
         * @param options
         * @param callback
         */
        open(url: string, options: WindowOptions, callback: (window: nw.Window) => void): void
    }
}
