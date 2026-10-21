import {useH264, useOPUS, usePCMU, useVP8, useVP9} from '../lib/peer/media/codec.js'
import type {RTCRtpCodecParameters} from '../lib/peer/media/parameters.js'

/**
 * The codecs the connections negotiate, by their MIME type in lower case
 */
const CODECS: Record<string, () => RTCRtpCodecParameters> = {
    'audio/opus': (): RTCRtpCodecParameters => useOPUS(),
    'audio/pcmu': (): RTCRtpCodecParameters => usePCMU(),
    'video/vp8': (): RTCRtpCodecParameters => useVP8(),
    'video/vp9': (): RTCRtpCodecParameters => useVP9(),
    'video/h264': (): RTCRtpCodecParameters => useH264()
}

/**
 * The MIME types of the codecs supported
 */
export const SUPPORTED_CODECS: string[] = ['audio/opus', 'audio/PCMU', 'video/VP8', 'video/VP9', 'video/H264']

/**
 * The codecs offered by default, in the order of preference: the ones of the browsers, VP8 first as Chrome does
 */
export const DEFAULT_CODECS: string[] = ['audio/opus', 'audio/PCMU', 'video/VP8', 'video/H264', 'video/VP9']

/**
 * The MIME type of a codec as written in SUPPORTED_CODECS (`video/H264`, `audio/opus`), whatever its case
 * @param mimeType
 */
export function canonicalCodec(mimeType: string): string {
    return SUPPORTED_CODECS.find((codec: string): boolean => codec.toLowerCase() === mimeType.toLowerCase()) ?? mimeType
}

/**
 * The codec of the engine of a MIME type
 * @param mimeType
 */
export function engineCodecOf(mimeType: string): RTCRtpCodecParameters {
    const codec: (() => RTCRtpCodecParameters) | undefined = CODECS[mimeType.toLowerCase()]
    if (!codec) throw new TypeError(`The codec ${mimeType} is not supported: ${SUPPORTED_CODECS.join(', ')}`)
    return codec()
}

/**
 * The codecs of the engine of a list of MIME types, by kind
 * @param mimeTypes
 */
export function engineCodecsOf(mimeTypes: string[]): {audio: RTCRtpCodecParameters[], video: RTCRtpCodecParameters[]} {
    const codecs: RTCRtpCodecParameters[] = mimeTypes.map(engineCodecOf)
    return {
        audio: codecs.filter((codec: RTCRtpCodecParameters): boolean => codec.mimeType.toLowerCase().startsWith('audio/')),
        video: codecs.filter((codec: RTCRtpCodecParameters): boolean => codec.mimeType.toLowerCase().startsWith('video/'))
    }
}
