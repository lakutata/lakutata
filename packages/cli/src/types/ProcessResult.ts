/**
 * The result of a command run (runCommand())
 */
export type ProcessResult = {
    /**
     * The exit code
     */
    code: number
    /**
     * The output (stdout and stderr)
     */
    output: string
}
