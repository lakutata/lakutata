import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Controller, Result} from '@lakutata/entrypoint'
import {MCPTool, ToToolResult} from '../exports/MCP.js'
import {StatusDTO} from './support/Tools.js'

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

describe('ToToolResult', (): void => {

    it('gives the structured content of the class instances of a tool declaring an output', async (): Promise<void> => {
        const status: StatusDTO = new StatusDTO({sn: 'A1', online: true})
        assert.deepStrictEqual((await ToToolResult(status, true)).structuredContent, {sn: 'A1', online: true})
        assert.deepStrictEqual((await ToToolResult(Result.status(200, status), true)).structuredContent, {sn: 'A1', online: true})
        //Without output, a class instance is its JSON only
        assert.strictEqual((await ToToolResult(status)).structuredContent, undefined)
        assert.deepStrictEqual(JSON.parse(((await ToToolResult(status)).content[0] as { text: string }).text), {sn: 'A1', online: true})
        //A plain object is always structured; the values whose JSON is not an object never are
        assert.deepStrictEqual((await ToToolResult({sn: 'B2'})).structuredContent, {sn: 'B2'})
        assert.strictEqual((await ToToolResult(new Date(0), true)).structuredContent, undefined)
        assert.strictEqual((await ToToolResult([status], true)).structuredContent, undefined)
        assert.strictEqual((await ToToolResult('online', true)).structuredContent, undefined)
    })
})
