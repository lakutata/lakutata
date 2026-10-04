/**
 * The error number and message of an error, as `DescribeError()` gives them and the HTTP responders answer them
 * (`{errno, errMsg}`).
 */
export type ErrorDescription = {
    /**
     * The `errno` of the error, else its `code`, else `'E_UNKNOWN'`.
     */
    errno: string | number
    /**
     * The `errMsg` of the error, else its `message`, else the error converted to a string.
     */
    errMsg: string
}
