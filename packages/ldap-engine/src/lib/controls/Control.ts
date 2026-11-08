/**
 * A control of a message (RFC 4511 §4.1.11): its OID, whether it is critical, and its value as bytes. The codecs of
 * the known controls turn the value into an object and back.
 */
export interface Control {
    /**
     * The OID of the control
     */
    oid: string
    /**
     * Whether the operation must fail (`unavailableCriticalExtension`) rather than run without the control
     */
    critical: boolean
    /**
     * The value, encoded as the control's specification says
     */
    value?: Buffer
}

/**
 * The codec of a control: it builds the control from a value object, and reads the value object of a control
 */
export interface ControlCodec<T> {
    /**
     * The OID of the control
     */
    readonly oid: string

    /**
     * Build the control
     * @param value The value.
     * @param critical Whether it is critical (`false` by default).
     */
    encode(value: T, critical?: boolean): Control

    /**
     * Read the value of the control
     * @param control The control.
     */
    decode(control: Control): T
}

/**
 * The codec of a value: the bytes of a value object and back (the value of an extended operation, of an intermediate
 * response)
 */
export interface ValueCodec<T> {
    /**
     * The bytes of the value
     * @param value The value.
     */
    encode(value: T): Buffer

    /**
     * Read the value
     * @param bytes The bytes.
     */
    decode(bytes: Buffer): T
}
