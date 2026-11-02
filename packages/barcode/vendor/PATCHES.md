# The changes made to the vendored libraries

Each change made in lakutata to the source of a library in `vendor/`, with its reason. `scripts/sync.mjs` keeps them
when it brings a library to a newer release (a three-way merge); a change the new release makes useless is removed then.

## zxing-cpp

### `core/src/qrcode/QRReader.cpp`: the pure read of a QR Code asked for by its models

`readPure()` looked for a QR Code when the formats asked for included the symbology `QRCode`, while the other read of
the file (and the formats of the results) asks for the models, `QRCodeModel1 | QRCodeModel2`. A read asking for
`QRCodeModel2` alone, with `isPure`, found nothing. It asks for the models too.

### The C++20 that the clang 15 of DevEco Studio (HarmonyOS) does not have

The OpenHarmony toolchain of DevEco Studio is clang 15, which lacks two features of C++20 that clang 16 brought; the
code is written the way clang 15 takes it, with the same meaning.

- `core/src/LocalGrid.cpp`: the aggregates `DistMod` are added with `push_back({...})` instead of `emplace_back(...)`
  (the initialization of an aggregate by parentheses, P0960, through `std::construct_at`).
- `core/src/pdf417/PDFCodewordDecoder.cpp`: the aggregate `CodewordPattern` is initialized with braces instead of
  parentheses (P0960), its two values converted to the types of its bit-fields.
- `core/src/qrcode/QRDetector.cpp`: the bounds of the finder patterns are plain variables instead of structured
  bindings, which a lambda captures (P1091).
