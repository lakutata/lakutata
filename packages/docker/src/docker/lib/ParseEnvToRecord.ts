/**
 * Turn a list of environment variables as the Engine API gives them (`['PATH=/usr/bin', 'MODE=a=b']`) into a record by
 * name. A variable is split at its first `=`; an entry without `=` is skipped; a repeated name keeps its last value.
 * @param rawEnv The `NAME=value` entries; `null` or `undefined` for none.
 * @returns The values by name (`{PATH: '/usr/bin', MODE: 'a=b'}`).
 * @example
 * ```typescript
 * import {ParseEnvToRecord} from 'lakutata/com/docker'
 *
 * const env: Record<string, string> = ParseEnvToRecord(['PATH=/usr/bin', 'MODE=a=b', 'EMPTY='])
 * console.log(env) //{PATH: '/usr/bin', MODE: 'a=b', EMPTY: ''}
 * ```
 */
export function ParseEnvToRecord(rawEnv?: string[] | null): Record<string, string> {
    const environments: Record<string, string> = {}
    for (const envString of rawEnv ?? []) {
        const splitPos: number = envString.indexOf('=')
        if (splitPos !== -1) environments[envString.substring(0, splitPos)] = envString.substring(splitPos + 1)
    }
    return environments
}
