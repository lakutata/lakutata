//The host page of the window, trusted (it runs in NW.js, with Node.js): the user interface in its webview, isolated
//(packages/ui), its messages forwarded to the actions of the application (nwjsServiceEntrypoint), the events of the
//application pushed back to it

/**
 * The channel of the messages between the host page and the user interface (packages/ui/src/ipc.ts)
 */
const CHANNEL = 'lakutata:service'

const view = document.getElementById('ui')
const query = new URLSearchParams(location.search)
/**
 * The user interface: the dev server of Vite in development, its built files otherwise
 */
const ui = new URL(query.get('ui'), location.href)
/**
 * The bridge of the actions, put on the global object of NW.js by the entrypoint of the application
 */
const bridge = global[Symbol.for('lakutata:service')]
/**
 * The ids of the pages subscribed to the events of the application
 */
const clients = new Set()

/**
 * Send a message to the user interface
 * @param message
 */
function send(message) {
    view.contentWindow.postMessage({channel: CHANNEL, ...message}, ui.origin)
}

window.addEventListener('message', async (event) => {
    //The messages of the user interface only
    if (event.source !== view.contentWindow || event.origin !== ui.origin || event.data?.channel !== CHANNEL) return
    const message = event.data
    if (message.type === 'invoke') {
        const response = await bridge.invoke(message.data, message.clientId)
        try {
            send({type: 'response', id: message.id, response: response})
        } catch (error) {
            //A result the messages cannot carry (a function…)
            send({type: 'response', id: message.id, response: {success: false, error: {message: `The result of the action cannot be given to the page: ${error.message}`}, payload: null}})
        }
    } else if (message.type === 'subscribe' && !clients.has(message.clientId)) {
        clients.add(message.clientId)
        bridge.subscribe(message.clientId, (name, args) => send({type: 'event', name: name, args: args}))
    }
})

/**
 * Unsubscribe the pages from the events of the application
 */
function unsubscribe() {
    for (const clientId of clients) bridge.unsubscribe(clientId)
    clients.clear()
}

//A page loaded again is a new client
view.addEventListener('loadstart', (event) => {
    if (event.isTopLevel) unsubscribe()
})
//The page loaded is given the source of the messages of the host page
view.addEventListener('loadstop', () => send({type: 'hello'}))
//The dev server of Vite may start after the application: its page is loaded again until it answers
let attempts = 0
view.addEventListener('loadabort', (event) => {
    if (event.isTopLevel && event.reason === 'ERR_CONNECTION_REFUSED' && attempts++ < 60) setTimeout(() => view.src = ui.href, 500)
})
//The DevTools of the user interface, in development
if (query.has('devtools')) view.addEventListener('loadstop', () => view.showDevTools(true), {once: true})
window.addEventListener('beforeunload', unsubscribe)
view.src = ui.href
