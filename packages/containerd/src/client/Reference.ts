/**
 * A reference of an image: its registry, its repository, its tag or its digest
 */
export type ImageReference = {
    /**
     * The registry, as named by the references (docker.io)
     */
    registry: string
    /**
     * The host of the API of the registry (registry-1.docker.io for docker.io)
     */
    host: string
    repository: string
    tag?: string
    digest?: string
    /**
     * The name of the image in containerd, the one of ctr and nerdctl (docker.io/library/busybox:latest)
     */
    name: string
}

/**
 * The registry of the references without registry
 */
const DEFAULT_REGISTRY: string = 'docker.io'

/**
 * Parse a reference of an image as Docker (and containerd) normalize it: busybox is docker.io/library/busybox:latest,
 * user/app docker.io/user/app:latest, the first part of a reference is its registry when it has a dot, a port or is
 * localhost
 * @param reference
 */
export function parseReference(reference: string): ImageReference {
    const raw: string = reference.trim()
    if (!raw || /\s/.test(raw)) throw new Error(`The reference of an image "${reference}" is not valid`)
    let rest: string = raw
    let digest: string | undefined
    const at: number = rest.indexOf('@')
    if (at >= 0) {
        digest = rest.slice(at + 1)
        rest = rest.slice(0, at)
        if (!/^[a-z0-9]+(?:[.+_-][a-z0-9]+)*:[a-zA-Z0-9=_-]+$/.test(digest)) throw new Error(`The digest of the reference "${reference}" is not valid`)
    }
    let tag: string | undefined
    const colon: number = rest.lastIndexOf(':')
    if (colon > rest.lastIndexOf('/')) {
        tag = rest.slice(colon + 1)
        rest = rest.slice(0, colon)
        if (!/^[\w][\w.-]{0,127}$/.test(tag)) throw new Error(`The tag of the reference "${reference}" is not valid`)
    }
    const parts: string[] = rest.split('/')
    let registry: string = DEFAULT_REGISTRY
    if (parts.length > 1 && (parts[0].includes('.') || parts[0].includes(':') || parts[0] === 'localhost')) registry = parts.shift()!
    if (registry === 'index.docker.io' || registry === 'registry-1.docker.io') registry = DEFAULT_REGISTRY
    let repository: string = parts.join('/')
    if (registry === DEFAULT_REGISTRY && parts.length === 1) repository = `library/${repository}`
    if (!/^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*$/.test(repository)) throw new Error(`The repository of the reference "${reference}" is not valid (lower case letters, digits, separators)`)
    if (!tag && !digest) tag = 'latest'
    return {
        registry: registry,
        host: registry === DEFAULT_REGISTRY ? 'registry-1.docker.io' : registry,
        repository: repository,
        tag: tag,
        digest: digest,
        name: `${registry}/${repository}${tag ? `:${tag}` : ''}${digest ? `@${digest}` : ''}`
    }
}

/**
 * The name of an image in containerd of a reference given by the users (busybox → docker.io/library/busybox:latest),
 * the reference itself when it is not one
 * @param reference
 */
export function imageName(reference: string): string {
    try {
        return parseReference(reference).name
    } catch {
        return reference
    }
}
