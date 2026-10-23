/**
 * The API of the packages providing a channel or an adapter
 */
export {defineChannel, getChannel, hasChannel, getChannelByContextType} from '../channel/Channel.js'
export type {ChannelDefinition, ChannelKind, ChannelEntry, ChannelMatch, ChannelMatcher} from '../channel/Channel.js'
export {isEntrypointAdapter, commandMap} from '../channel/EntrypointAdapter.js'
export type {EntrypointAdapter, ChannelRuntime, ChannelActionInfo, DispatchOptions} from '../channel/EntrypointAdapter.js'
export {registerControllerAction} from '../lib/ControllerEntrypoint.js'
export type {ActionDetails, ActionInfo} from '../lib/ControllerEntrypoint.js'
export {getActionDTOAndOptions} from '../lib/GetActionDTOAndOptions.js'
export {ActionOptions} from '../lib/ActionOptions.js'
export {HTTPChannel, CLIChannel, ServiceChannel, ScheduleChannel} from '../channel/BuiltinChannels.js'
export {ServiceResponseCodec, type ServiceResponse} from '../lib/ServiceResponseCodec.js'
export {JSONRPCProtocol, type JSONRPCDispatch} from '../adapter/jsonrpc/JSONRPCProtocol.js'
export {getPrefix, setPrefix} from '../lib/Prefix.js'
