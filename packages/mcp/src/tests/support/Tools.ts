import {DTO, Exception} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {Controller, Result} from '@lakutata/entrypoint'
import {Prefix} from '@lakutata/entrypoint/decorator/ctrl'
import {MCPContext, MCPTool} from '../../exports/MCP.js'

export class DeviceDTO extends DTO {
    @Expect(DTO.String().required().description('The serial number'))
    public sn: string
}

export class StatusDTO extends DTO {
    @Expect(DTO.String().required())
    public sn: string

    @Expect(DTO.Boolean().required())
    public online: boolean
}

export class OfflineException extends Exception {
    public errno: string = 'E_OFFLINE'
}

/**
 * The calls seen by the tools
 */
export const calls: { tool: string, type: string, authInfo?: unknown }[] = []

@Prefix({mcp: 'device'})
export class DeviceController extends Controller {

    @MCPTool('status', DeviceDTO, {title: 'Device status', description: 'The status of a device', readOnly: true, idempotent: true, output: StatusDTO})
    public async status(input: DeviceDTO): Promise<StatusDTO> {
        const context: MCPContext = this.context as MCPContext
        calls.push({tool: context.tool, type: context.type, authInfo: context.authInfo})
        return {sn: input.sn, online: input.sn !== 'off'} as StatusDTO
    }

    @MCPTool('reboot', DeviceDTO, {destructive: true})
    public async reboot(input: DeviceDTO): Promise<string> {
        if (input.sn === 'off') throw new OfflineException('The device {sn} is offline', {sn: input.sn})
        return `Rebooting ${input.sn}`
    }
}

export class ToolController extends Controller {

    @MCPTool('echo')
    public async echo(input: Record<string, unknown>): Promise<unknown> {
        return input
    }

    @MCPTool('picture')
    public async picture(): Promise<unknown> {
        return Result.file(Buffer.from('png-bytes'), {contentType: 'image/png'})
    }

    @MCPTool('raw')
    public async raw(): Promise<unknown> {
        return {content: [{type: 'text', text: 'first'}, {type: 'text', text: 'second'}]}
    }

    @MCPTool('count')
    public async count(): Promise<string> {
        const context: MCPContext = this.context as MCPContext
        for (let step: number = 1; step <= 3; step++) await context.progress(step, 3, `step ${step}`)
        return 'counted'
    }

    @MCPTool('slow')
    public async slow(): Promise<string> {
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 150))
        return 'slow'
    }
}
