/**
 * The options of {@link NATS.subscribe}.
 */
export type SubscribeOptions = {
    /**
     * The queue group of the subscription: the subscriptions of one queue group on one subject share its messages, each
     * message delivered to one of them only (load balancing between the instances of a service).
     * @default none: every subscription receives every message
     */
    queue?: string
    /**
     * The number of messages after which the subscription ends by itself (unsubscribed automatically).
     * @default none: no limit
     */
    max?: number
    /**
     * Whether the messages are handled one after the other, each callback awaited before the next message, instead of
     * concurrently (a callback started for each message as it arrives).
     * @default false
     */
    iterator?: boolean
    /**
     * Build the response to a request (a message with a reply subject) whose handling failed: the callback threw, the
     * payload could not be decoded or read from the object store, or the response could not be encoded or sent. Its
     * return value is encoded with the codec and sent (never relayed through the object store); `undefined` answers
     * nothing, and the requester waits for its timeout. Without it, a failed request is not answered either.
     * It lets an upper layer (such as the service entrypoint) answer with its own error protocol.
     * @param error The error of the handling.
     * @returns The payload of the response, or `undefined` to answer nothing.
     * @default none: a failed request is not answered
     */
    errorResponse?: (error: any) => any
}