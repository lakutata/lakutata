/**
 * A name as a token of the names of the servers (the streams, consumers, buckets and subjects of NATS, the topics of
 * Kafka): the letters, the digits and `-` kept, every other character written `_<hex>_`
 * @param name The name.
 */
export function nameToken(name: string): string {
    return name.replace(/[^A-Za-z0-9-]/gu, (character: string): string => `_${character.codePointAt(0)!.toString(16)}_`)
}
