/**
 * Why the application exits, given to the done handler (onDone)
 */
export type ApplicationExitReason = {
    /**
     * The exit code of the process
     */
    code: number
    /**
     * The signal ending the application (shutdownSignals), none when the application exits by app.exit()
     */
    signal?: NodeJS.Signals
}
