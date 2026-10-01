/**
 * The parameters of the context of the commands (CLIContext)
 */
export type CLIContextParams = {
    readonly command: string
    readonly data: Record<string, any>
}
