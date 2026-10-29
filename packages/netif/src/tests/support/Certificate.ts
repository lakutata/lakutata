/**
 * A self-signed certificate of localhost, 127.0.0.1 and ::1 (valid from 2020 to 2120: the clock of a virtual machine may
 * be late) and its key, made for the tests of the TLS servers only
 */
export const CERTIFICATE: string = `-----BEGIN CERTIFICATE-----
MIIBjDCCATKgAwIBAgIUEHUpvBo9aTqRb9hgRGPCDp6Add4wCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTIwMDEwMTAwMDAwMFoYDzIxMjAwMTAx
MDAwMDAwWjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAAStRpIBXBHUz53xALhKNWWMCdamGIKrY9iBhmbYuUsxnDye1EWQyrqy
aeYRtNm9/oEfYzRTcOVPWn7ZHJ1lSo1to2AwXjAdBgNVHQ4EFgQU9vKyrrsmxeWH
5oUpk9ro1WEMAG4wDwYDVR0TAQH/BAUwAwEB/zAsBgNVHREEJTAjhwR/AAABhxAA
AAAAAAAAAAAAAAAAAAABgglsb2NhbGhvc3QwCgYIKoZIzj0EAwIDSAAwRQIgDxD8
sCvMDjsrEowr1jjW9XUXe3YlkAlc6CFOI/J45DgCIQD1lbSLGCHbCeTVYgVwdDEN
XLhA/4XNojv1NAt+lsvfgA==
-----END CERTIFICATE-----
`

/**
 * The key of the certificate of the tests
 */
export const KEY: string = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgs1hod+wVPz+JD/wz
e7EQqoYFz/SCnTPH4/hH7sjIGzKhRANCAAStRpIBXBHUz53xALhKNWWMCdamGIKr
Y9iBhmbYuUsxnDye1EWQyrqyaeYRtNm9/oEfYzRTcOVPWn7ZHJ1lSo1t
-----END PRIVATE KEY-----
`
