import type {Schema} from '../lib/Protobuf.js'

/**
 * The `.proto` definition (proto3) of the gRPC service `lakutata.service.v1.Service` served by
 * `grpcServiceEntrypoint`: write it to a `.proto` file to generate the clients of the other languages (`protoc`,
 * grpcio-tools), or give it to `grpcurl -proto`.
 *
 * - `Invoke(InvokeRequest) returns (InvokeResponse)`: `data` is the UTF-8 JSON of the action's pattern and input;
 *   `success` tells the result (`payload`, the JSON of the action's result, empty for none) from the failure
 *   (`error`, the JSON of the error's message, `errno` and other properties).
 * - `Events(EventsRequest) returns (stream Event)`: the events pushed to the client, each with its name (`event`) and
 *   the JSON array of its arguments (`args`); the first one is `client`, the client's id.
 * - The client's id is the `id` metadata of its calls; the service has no reflection, so the clients need this proto.
 * @example
 * ```typescript
 * import {writeFileSync} from 'node:fs'
 * import {SERVICE_PROTO} from '@lakutata/grpc/service'
 *
 * //Then: grpcurl -plaintext -proto lakutata.proto -H 'id: cli-1' -d '{"data": "eyJjbWQiOiJvcmRlci5nZXQiLCJpZCI6MX0="}' localhost:50051 lakutata.service.v1.Service/Invoke
 * writeFileSync('lakutata.proto', SERVICE_PROTO)
 * ```
 */
export const SERVICE_PROTO: string = `syntax = "proto3";

package lakutata.service.v1;

// The service actions of a lakutata application (its service channel): the pattern and the input of an action are an
// object of JSON, matched to the patterns of the actions, as over NATS. The id of a client is its metadata "id".
service Service {
  // Invoke an action: its pattern and its input (JSON), its result or its error (JSON)
  rpc Invoke (InvokeRequest) returns (InvokeResponse);
  // The events pushed to the client (Entrypoint.notify, broadcast): the first one is "client", its id as its argument
  rpc Events (EventsRequest) returns (stream Event);
}

message InvokeRequest {
  // The JSON of the pattern and of the input of the action
  bytes data = 1;
}

message InvokeResponse {
  bool success = 1;
  // The JSON of the result of the action
  bytes payload = 2;
  // The JSON of the error of the action (its message, its errno and its other properties)
  bytes error = 3;
}

message EventsRequest {
}

message Event {
  string event = 1;
  // The JSON of the arguments of the event (an array)
  bytes args = 2;
}
`

/**
 * The gRPC method paths of the service `lakutata.service.v1.Service`, for the `GRPCConnection` calls and the
 * `GRPCServer` methods.
 */
export const SERVICE_METHODS = {
    /**
     * The unary method invoking an action.
     */
    INVOKE: '/lakutata.service.v1.Service/Invoke',
    /**
     * The server streaming method of the events pushed to a client.
     */
    EVENTS: '/lakutata.service.v1.Service/Events'
} as const

export const InvokeRequest: Schema = {data: {no: 1, type: 'bytes'}}

export const InvokeResponse: Schema = {
    success: {no: 1, type: 'bool'},
    payload: {no: 2, type: 'bytes'},
    error: {no: 3, type: 'bytes'}
}

export const EventsRequest: Schema = {}

export const ServiceEvent: Schema = {
    event: {no: 1, type: 'string'},
    args: {no: 2, type: 'bytes'}
}

/**
 * The bytes of a value of JSON (none for undefined)
 * @param value
 */
export function JSONBytes(value: unknown): Buffer | undefined {
    return value === undefined ? undefined : Buffer.from(JSON.stringify(value))
}

/**
 * The value of the bytes of JSON (undefined for none)
 * @param bytes
 */
export function FromJSONBytes(bytes: Uint8Array | undefined): unknown {
    return bytes?.length ? JSON.parse(Buffer.from(bytes).toString('utf8')) : undefined
}
