export type SubscribeOptions = {
    queue?: string
    max?: number
    iterator?: boolean
    /**
     * The payload answering a request (a message with a reply subject) whose handling failed, encoded with the codec;
     * undefined answers nothing (the requester waits for its timeout).
     * It lets an upper layer (such as the service entrypoint) answer with its own error protocol
     */
    errorResponse?: (error: any) => any
}