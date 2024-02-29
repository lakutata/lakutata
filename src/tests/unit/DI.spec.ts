import {describe, it} from 'node:test'

describe('DI Test', async function (): Promise<void> {
    await it('should 1', async (context): Promise<void> => {
        console.log('1')
    })
    await it('should 2', async (context): Promise<void> => {
        console.log('2')
    })
})
