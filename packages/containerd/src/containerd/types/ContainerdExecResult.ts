/**
 * The result of a command executed in a running container ({@link ContainerdContainer.exec}). The outputs are decoded
 * as UTF-8 and held in memory.
 */
export type ContainerdExecResult = {
    /**
     * The exit code of the command (`137` when it was killed by its `timeout`).
     */
    exitCode: number
    /**
     * Its standard output. Without `mkfifo` on the host, its standard error is in it too.
     */
    stdout: string
    /**
     * Its standard error; `''` without `mkfifo` on the host (it is in `stdout`).
     */
    stderr: string
}
