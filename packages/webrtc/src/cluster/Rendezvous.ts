import {createHash} from 'node:crypto'

/**
 * The node responsible for a key among some nodes (rendezvous hashing): every node computes the same one, and only the
 * keys of a node leaving or joining change hands
 * @param key
 * @param nodes The ids of the nodes.
 * @returns The id of the node, undefined without nodes.
 */
export function rendezvous(key: string, nodes: readonly string[]): string | undefined {
    let chosen: string | undefined
    let best: string = ''
    for (const node of nodes) {
        const score: string = createHash('sha1').update(key).update('\0').update(node).digest('hex')
        if (score > best) {
            best = score
            chosen = node
        }
    }
    return chosen
}
