/**
 * Parse raw ENV filed to record
 * @param rawEnv
 * @constructor
 */
export function ParseEnvToRecord(rawEnv?: string[] | null): Record<string, string> {
    const environments: Record<string, string> = {}
    for (const envString of rawEnv ?? []) {
        const splitPos: number = envString.indexOf('=')
        if (splitPos !== -1) environments[envString.substring(0, splitPos)] = envString.substring(splitPos + 1)
    }
    return environments
}
