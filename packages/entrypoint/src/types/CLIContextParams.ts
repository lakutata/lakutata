/**
 * The parameters creating a `CLIContext`, given by the CLI adapters.
 */
export type CLIContextParams = {
    /**
     * The command of the action as declared, its controller prefix included (`'user:get <id>'`).
     */
    readonly command: string
    /**
     * The input of the action before its validation: the positional arguments and the options of the command, by the
     * names of the DTO properties.
     */
    readonly data: Record<string, any>
}
