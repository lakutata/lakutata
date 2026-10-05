import type {DTO} from '@lakutata/core'
import type {Controller} from '@lakutata/entrypoint'
import {ActionOptions, getActionDTOAndOptions, registerControllerAction} from '@lakutata/entrypoint/channel'
import {MCPChannel} from '../channel/MCPChannel.js'
import type {MCPContext, MCPRequestKind} from '../context/MCPContext.js'
import {type MCPMetadata, RegisterMCPMetadata} from './Metadata.js'

/**
 * Register an action of the MCP channel
 * @param kind
 * @param address the name of the tool or of the prompt, the URI (template) of the resource
 * @param target
 * @param propertyKey
 * @param dtoConstructorOrOptions
 * @param options
 * @param split takes the MCP metadata out of the options, the rest are the options of the action
 */
export function RegisterMCPAction<Options extends ActionOptions<MCPContext>>(
    kind: MCPRequestKind,
    address: string,
    target: Controller,
    propertyKey: any,
    dtoConstructorOrOptions: typeof DTO | Options | undefined,
    options: Options | undefined,
    split: (options: Options) => [MCPMetadata, ActionOptions<MCPContext>]
): void {
    const isDTO: boolean = typeof dtoConstructorOrOptions === 'function'
    const [metadata, actionOptions] = split((isDTO ? options : dtoConstructorOrOptions as Options | undefined) ?? {} as Options)
    const [dtoConstructor, validatedOptions] = isDTO
        ? getActionDTOAndOptions(dtoConstructorOrOptions as typeof DTO, actionOptions)
        : getActionDTOAndOptions(actionOptions)
    const pattern: Record<string, string> = {[kind]: address}
    const metadataId: string | undefined = RegisterMCPMetadata(metadata)
    if (metadataId) pattern.metadata = metadataId
    registerControllerAction(MCPChannel, target, propertyKey as never, pattern, dtoConstructor, validatedOptions)
}
