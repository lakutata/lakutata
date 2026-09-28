import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Controller} from '@lakutata/entrypoint'
import {MCPTool} from '../exports/MCP.js'

describe('MCPTool', (): void => {

    it('rejects the names MCP does not allow', (): void => {
        assert.throws((): void => {
            class InvalidController extends Controller {
                @MCPTool('get device')
                public async get(): Promise<void> {
                }
            }
            void InvalidController
        }, /Invalid MCP tool name "get device"/)
    })
})
