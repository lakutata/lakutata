import {DataUriOptions} from './DataUriOptions.js'

export interface Base64Options extends Pick<DataUriOptions, 'paddingRequired'> {
    /**
     * if true, uses the URI-safe base64 format which replaces `+` with `-` and `\` with `_`.
     *
     * @default false
     */
    urlSafe?: boolean;
}
