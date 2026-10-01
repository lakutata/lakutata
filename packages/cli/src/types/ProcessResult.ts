/**
 * The result of a command run (Run())
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
