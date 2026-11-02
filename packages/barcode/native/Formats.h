//The formats of the package: the ones zint writes and zxing-cpp reads, by their names in the package, with the
//symbology of zint making them, the format zxing-cpp reports reading them, and the range of their options. The other
//capabilities (human readable text, GS1 data, ECI, add-ons) are asked to zint (ZBarcode_Cap)
#pragma once

#include <string>
#include <vector>

#include "BarcodeFormat.h"

namespace barcode {

//How the error correction of a format is given
enum class ErrorCorrection {
    //Not chosen
    None,
    //A letter: QR Code (L, M, Q, H), Micro QR Code (L, M, Q), rMQR Code (M, H)
    Letters,
    //A level: PDF417 (0 to 8), Aztec (1 to 4)
    Level
};

struct Format {
    //The name of the package ("QRCode")
    const char *name;
    //The symbology of zint (BARCODE_QRCODE)
    int symbology;
    //The symbology of zint when the content is GS1 data, 0 when the same (Code 128: BARCODE_GS1_128)
    int gs1Symbology;
    //The format zxing-cpp reports reading it
    ZXing::BarcodeFormat reads;
    ErrorCorrection errorCorrection;
    //The letters accepted (Letters), or the levels (Level: from, to)
    const char *letters;
    int levelFrom;
    int levelTo;
    //The versions accepted (1 to versions), 0 when not chosen
    int versions;
    //The format a read reports for it, when zxing-cpp cannot tell it from another one: a UPC-A is an EAN-13 starting
    //with 0, an ISBN one starting with 978 or 979; ITF-14, Compact PDF417, Aztec Rune and DataBar Stacked
    //Omnidirectional are read as their family. Null when it is the format itself
    const char *readsAs;
};

//The formats, in the order of the package
const std::vector<Format> &formats();

//A format by its name, null when it is not one
const Format *formatOf(const std::string &name);

//The name of a format zxing-cpp reports: the one of the package, else the name of zxing-cpp (a format it reads that
//the package does not write: "QRCodeModel1")
std::string nameOfRead(ZXing::BarcodeFormat format);

//The formats of zxing-cpp to read for names of the package
ZXing::BarcodeFormats readFormatsOf(const std::vector<std::string> &names);

}
