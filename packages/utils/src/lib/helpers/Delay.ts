/**
 * Async delay function
 * @param ms
 * @constructor
 */
export async function Delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(() => resolve(), ms))
}
