/**
 * The result of a command run in a running container ({@link DockerContainer.exec}), the same as the containerd
 * component's: a command exiting with a non-zero code resolves too, its code given. The outputs are decoded as UTF-8
 * and held in memory.
 */
export type ContainerExecResult = {
    /**
     * The exit code of the command (`0` for a success; `126` for a command which cannot be run, `127` for one not
     * found).
     */
    exitCode: number
    /**
     * Its standard output.
     */
    stdout: string
    /**
     * Its standard error.
     */
    stderr: string
}
