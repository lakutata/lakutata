/**
 * Parse raw ENV filed to record
 * @param rawEnv
 * @constructor
 */
export function ParseEnvToRecord(rawEnv: string[] = []): Record<string, string> {
    let environments: Record<string, string> = {}
    rawEnv.map((envString: string): Record<string, string> | null => {
        const splitPos: number = envString.indexOf('=')
        if (splitPos === -1) return null
        return {[envString.substring(0, splitPos)]: envString.substring(splitPos + 1)}
    }).forEach((envKeyValuePair: Record<string, string> | null) => {
        if (envKeyValuePair) environments = {...environments, ...envKeyValuePair}
    })
    return environments
}
