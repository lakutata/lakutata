/**
 * The process is ending (EndProcess): the code given first is its exit code
 */
let ending: boolean = false

/**
 * Whether ending exits the process: an application runs in a process of its own by default, else in the process of a
 * host (the Node.js embedded in a mobile application), which the application leaves running (exitProcess: false)
 */
let exitsProcess: boolean = true

/**
 * End the process with a code: it exits by itself, its work done (process.exitCode), else it is ended after a moment
 * (an object keeping it running). Ended by process.exit at once, node crashes on Windows while the connections of fetch
 * close (libuv: UV_HANDLE_CLOSING); the process exits by itself as soon as they are closed. The code given first is the
 * exit code: the code still running once the application is destroyed (its launch going on after its exit) does not
 * change it. In the process of a host, the code is only given to it (process.exitCode)
 * @param code
 * @param grace the time it is given to exit by itself
 */
export function endProcess(code: number, grace: number = 500): void {
    if (ending) return
    ending = true
    process.exitCode = code
    if (exitsProcess) setTimeout((): never => process.exit(code), grace).unref()
}

/**
 * Whether the process is ending: the errors of the code still running are not the ones of the application
 */
export function isEnding(): boolean {
    return ending
}

/**
 * Set whether ending exits the process (true by default): false in the process of a host
 * @param exit
 */
export function setProcessExit(exit: boolean): void {
    exitsProcess = exit
}

/**
 * Whether ending exits the process
 */
export function processExits(): boolean {
    return exitsProcess
}
