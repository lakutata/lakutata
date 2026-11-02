#include "Formats.h"

#include <map>

#include "Errors.h"
#include "zint.h"

namespace barcode {

using ZXing::BarcodeFormat;

const std::vector<Format> &formats()
{
    //Never destroyed: the threads of the addon may still use it while the process exits
    static const std::vector<Format> &table = *new std::vector<Format>{
        //Retail
        {"EAN13", BARCODE_EAN13, 0, BarcodeFormat::EAN13, ErrorCorrection::None, "", 0, 0, 0, nullptr},
        {"EAN8", BARCODE_EAN8, 0, BarcodeFormat::EAN8, ErrorCorrection::None, "", 0, 0, 0, nullptr},
        {"UPCA", BARCODE_UPCA, 0, BarcodeFormat::UPCA, ErrorCorrection::None, "", 0, 0, 0, "EAN13"},
        {"UPCE", BARCODE_UPCE, 0, BarcodeFormat::UPCE, ErrorCorrection::None, "", 0, 0, 0, nullptr},
        {"ISBN", BARCODE_ISBNX, 0, BarcodeFormat::ISBN, ErrorCorrection::None, "", 0, 0, 0, "EAN13"},
        {"DataBar", BARCODE_DBAR_OMN, 0, BarcodeFormat::DataBarOmni, ErrorCorrection::None, "", 0, 0, 0, nullptr},
        {"DataBarStacked", BARCODE_DBAR_STK, 0, BarcodeFormat::DataBarStk, ErrorCorrection::None, "", 0, 0, 0, nullptr},
        {"DataBarStackedOmni", BARCODE_DBAR_OMNSTK, 0, BarcodeFormat::DataBarStkOmni, ErrorCorrection::None, "", 0, 0, 0, "DataBarStacked"},
        {"DataBarLimited", BARCODE_DBAR_LTD, 0, BarcodeFormat::DataBarLtd, ErrorCorrection::None, "", 0, 0, 0, nullptr},
        {"DataBarExpanded", BARCODE_DBAR_EXP, 0, BarcodeFormat::DataBarExp, ErrorCorrection::None, "", 0, 0, 0, nullptr},
        {"DataBarExpandedStacked", BARCODE_DBAR_EXPSTK, 0, BarcodeFormat::DataBarExpStk, ErrorCorrection::None, "", 0, 0, 0, nullptr},
        //Industrial
        {"Code128", BARCODE_CODE128, BARCODE_GS1_128, BarcodeFormat::Code128, ErrorCorrection::None, "", 0, 0, 0, nullptr},
        {"Code39", BARCODE_CODE39, 0, BarcodeFormat::Code39Std, ErrorCorrection::None, "", 0, 0, 0, nullptr},
        {"Code39Extended", BARCODE_EXCODE39, 0, BarcodeFormat::Code39Ext, ErrorCorrection::None, "", 0, 0, 0, nullptr},
        {"Code32", BARCODE_CODE32, 0, BarcodeFormat::Code32, ErrorCorrection::None, "", 0, 0, 0, nullptr},
        {"PZN", BARCODE_PZN, 0, BarcodeFormat::PZN, ErrorCorrection::None, "", 0, 0, 0, nullptr},
        {"Code93", BARCODE_CODE93, 0, BarcodeFormat::Code93, ErrorCorrection::None, "", 0, 0, 0, nullptr},
        {"ITF", BARCODE_C25INTER, 0, BarcodeFormat::ITF, ErrorCorrection::None, "", 0, 0, 0, nullptr},
        {"ITF14", BARCODE_ITF14, 0, BarcodeFormat::ITF14, ErrorCorrection::None, "", 0, 0, 0, "ITF"},
        {"Codabar", BARCODE_CODABAR, 0, BarcodeFormat::Codabar, ErrorCorrection::None, "", 0, 0, 0, nullptr},
        {"Telepen", BARCODE_TELEPEN, 0, BarcodeFormat::TelepenAlpha, ErrorCorrection::None, "", 0, 0, 0, nullptr},
        {"DXFilmEdge", BARCODE_DXFILMEDGE, 0, BarcodeFormat::DXFilmEdge, ErrorCorrection::None, "", 0, 0, 0, nullptr},
        //Matrix
        {"QRCode", BARCODE_QRCODE, 0, BarcodeFormat::QRCodeModel2, ErrorCorrection::Letters, "LMQH", 0, 0, 40, nullptr},
        {"MicroQRCode", BARCODE_MICROQR, 0, BarcodeFormat::MicroQRCode, ErrorCorrection::Letters, "LMQ", 0, 0, 4, nullptr},
        {"RMQRCode", BARCODE_RMQR, 0, BarcodeFormat::RMQRCode, ErrorCorrection::Letters, "MH", 0, 0, 38, nullptr},
        {"DataMatrix", BARCODE_DATAMATRIX, 0, BarcodeFormat::DataMatrix, ErrorCorrection::None, "", 0, 0, 48, nullptr},
        {"PDF417", BARCODE_PDF417, 0, BarcodeFormat::PDF417, ErrorCorrection::Level, "", 0, 8, 0, nullptr},
        {"CompactPDF417", BARCODE_PDF417COMP, 0, BarcodeFormat::CompactPDF417, ErrorCorrection::Level, "", 0, 8, 0, "PDF417"},
        {"MicroPDF417", BARCODE_MICROPDF417, 0, BarcodeFormat::MicroPDF417, ErrorCorrection::None, "", 0, 0, 0, nullptr},
        {"Aztec", BARCODE_AZTEC, 0, BarcodeFormat::AztecCode, ErrorCorrection::Level, "", 1, 4, 36, nullptr},
        {"AztecRune", BARCODE_AZRUNE, 0, BarcodeFormat::AztecRune, ErrorCorrection::None, "", 0, 0, 0, "Aztec"},
        {"MaxiCode", BARCODE_MAXICODE, 0, BarcodeFormat::MaxiCode, ErrorCorrection::None, "", 0, 0, 0, nullptr}
    };
    return table;
}

const Format *formatOf(const std::string &name)
{
    for (const Format &format : formats()) {
        if (name == format.name) return &format;
    }
    return nullptr;
}

std::string nameOfRead(BarcodeFormat format)
{
    for (const Format &known : formats()) {
        if (known.reads == format) return known.name;
    }
    //The names of zxing-cpp, from its list of formats
    static const std::map<BarcodeFormat, const char *> &names = *new std::map<BarcodeFormat, const char *>{
#define ZX_(NAME, SYM, VAR, FLAGS, ZINT, ENABLED, HRI) {BarcodeFormat::NAME, #NAME},
        ZX_BCF_LIST(ZX_)
#undef ZX_
    };
    const auto found = names.find(format);
    return found == names.end() ? "Unknown" : found->second;
}

ZXing::BarcodeFormats readFormatsOf(const std::vector<std::string> &names)
{
    std::vector<BarcodeFormat> chosen;
    for (const std::string &name : names) {
        const Format *format = formatOf(name);
        if (!format) throw BarcodeError(ErrorCode::Argument, "Unknown format " + name);
        //zxing-cpp finds no ISBN when it is asked for ISBN alone: an EAN-13 then
        chosen.push_back(format->symbology == BARCODE_ISBNX ? BarcodeFormat::EAN13 : format->reads);
    }
    return ZXing::BarcodeFormats(std::move(chosen));
}

}
