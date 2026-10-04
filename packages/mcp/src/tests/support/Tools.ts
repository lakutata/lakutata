import {DTO, Exception} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {Inject} from '@lakutata/core/decorator/di'
import {Controller, Result} from '@lakutata/entrypoint'
import {Prefix} from '@lakutata/entrypoint/decorator/ctrl'
import {MCPContext, MCPNotifier, MCPPrompt, MCPResource, MCPTool} from '../../exports/MCP.js'

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
export const calls: { kind: string, name: string, type: string, authInfo?: unknown }[] = []

@Prefix({mcp: 'device'})
export class DeviceController extends Controller {

    @Inject(MCPNotifier)
    protected readonly notifier: MCPNotifier

    @MCPTool('touch', DeviceDTO, {description: 'Mark the status of a device as changed'})
    public async touch(input: DeviceDTO): Promise<string> {
        this.notifier.resourceUpdated(`device://${input.sn}/status`)
        return 'touched'
    }

    @MCPTool('status', DeviceDTO, {title: 'Device status', description: 'The status of a device', readOnly: true, idempotent: true, output: StatusDTO})
    public async status(input: DeviceDTO): Promise<StatusDTO> {
        const context: MCPContext = this.context as MCPContext
        calls.push({kind: context.kind, name: context.name, type: context.type, authInfo: context.authInfo})
        return {sn: input.sn, online: input.sn !== 'off'} as StatusDTO
    }

    @MCPResource('device://{sn}/status', DeviceDTO, {description: 'The status of a device', mimeType: 'application/json', audience: ['assistant']})
    public async statusResource(input: DeviceDTO): Promise<StatusDTO> {
        const context: MCPContext = this.context as MCPContext
        calls.push({kind: context.kind, name: context.name, type: context.uri!})
        if (input.sn === 'missing') throw new OfflineException('The device {sn} is unknown', {sn: input.sn})
        return {sn: input.sn, online: true} as StatusDTO
    }

    @MCPResource('device://catalog', {resourceName: 'catalog', title: 'The device catalog'})
    public async catalog(): Promise<string> {
        return 'A1, B2'
    }

    @MCPPrompt('diagnose', DeviceDTO, {title: 'Diagnose a device', description: 'Diagnose the failures of a device'})
    public async diagnose(input: DeviceDTO): Promise<string> {
        return `Diagnose the device ${input.sn} from its status and its logs.`
    }

    @MCPPrompt('handover', DeviceDTO)
    public async handover(input: DeviceDTO): Promise<unknown[]> {
        return [`Take over the device ${input.sn}.`, {role: 'assistant', content: {type: 'text', text: 'Ready.'}}]
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

    @MCPTool('instance', DeviceDTO, {output: StatusDTO})
    public async instance(input: DeviceDTO): Promise<StatusDTO> {
        return new StatusDTO({sn: input.sn, online: true})
    }

    @MCPTool('mistyped', {output: StatusDTO})
    public async mistyped(): Promise<string> {
        return 'online'
    }

    @MCPTool('slow')
    public async slow(): Promise<string> {
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 150))
        return 'slow'
    }
}
