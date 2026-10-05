/**
 * The images of the FROM instructions of a Dockerfile, pulled before a build with credentials: their flags (--platform)
 * and their stage names (AS build) are skipped, the stages of the Dockerfile and scratch are not images, the variables
 * are the ARG declared before the first FROM (with their defaults) and the build arguments. The images whose variables
 * are unknown are skipped
 * @param dockerfile the content of the Dockerfile
 * @param buildargs
 */
export function parseBaseImages(dockerfile: string, buildargs: Record<string, string> = {}): string[] {
    //The instructions continued on the next lines (a backslash at the end of a line)
    const instructions: string[] = dockerfile.replace(/\\\r?\n/g, ' ').split(/\r?\n/).map((line: string): string => line.trim()).filter((line: string): boolean => !!line && !line.startsWith('#'))
    const variables: Record<string, string> = {}
    const stages: Set<string> = new Set()
    const images: string[] = []
    let beforeFirstFrom: boolean = true
    for (const instruction of instructions) {
        const [keyword, ...rest] = instruction.split(/\s+/)
        if (keyword.toUpperCase() === 'ARG' && beforeFirstFrom) {
            for (const declaration of rest) {
                const [name, value] = declaration.split(/=(.*)/s)
                if (buildargs[name] !== undefined) variables[name] = buildargs[name]
                else if (value !== undefined) variables[name] = value.replace(/^["']|["']$/g, '')
            }
        }
        if (keyword.toUpperCase() !== 'FROM') continue
        beforeFirstFrom = false
        const words: string[] = rest.filter((word: string): boolean => !word.startsWith('--'))
        const [reference, as, stage] = words
        if (as?.toUpperCase() === 'AS' && stage) stages.add(stage.toLowerCase())
        if (!reference) continue
        let unknown: boolean = false
        const image: string = reference.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)}?/g, (_: string, name: string): string => {
            if (variables[name] === undefined) unknown = true
            return variables[name] ?? ''
        })
        if (unknown || !image || image.toLowerCase() === 'scratch' || stages.has(image.toLowerCase()) || images.includes(image)) continue
        images.push(image)
    }
    return images
}
