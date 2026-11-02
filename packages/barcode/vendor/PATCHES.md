# The changes made to the vendored libraries

Each change made in lakutata to the source of a library in `vendor/`, with its reason. `scripts/sync.mjs` keeps them
when it brings a library to a newer release (a three-way merge); a change the new release makes useless is removed then.

## zxing-cpp

### `core/src/qrcode/QRReader.cpp`: the pure read of a QR Code asked for by its models

`readPure()` looked for a QR Code when the formats asked for included the symbology `QRCode`, while the other read of
the file (and the formats of the results) asks for the models, `QRCodeModel1 | QRCodeModel2`. A read asking for
`QRCodeModel2` alone, with `isPure`, found nothing. It asks for the models too.
