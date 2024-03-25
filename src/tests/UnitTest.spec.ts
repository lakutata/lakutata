import {describe} from 'node:test'
import DITests from './unit/DI.spec.js'
import BaseObjectTests from './unit/BaseObject.spec.js'
import DTOTests from './unit/DTO.spec.js'

(async () => {
    await describe('Lakutata Unit Test', async function (): Promise<void> {
        await DITests()
        await BaseObjectTests()
        await DTOTests()
    })
})()
