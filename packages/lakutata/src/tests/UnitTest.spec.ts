import {describe} from 'node:test'

(async () => {
    await describe('Lakutata Unit Test', async function (): Promise<void> {
        await import('./unit/DI.spec.js')
        await import('./unit/BaseObject.spec.js')
        await import('./unit/DTO.spec.js')
    })
})()
