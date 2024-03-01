import {describe} from 'node:test'

await describe('Lakutata Unit Test', async function (): Promise<void> {
    await import('./unit/DI.spec.js')
    await import('./unit/BaseObject.spec.js')
})
