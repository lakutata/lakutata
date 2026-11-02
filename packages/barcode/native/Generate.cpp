#include "Generate.h"

#include <cstring>
#include <memory>

#include "Errors.h"
#include "stb_image_write.h"
#include "zint.h"

namespace barcode {

namespace {

//The formats whose content is GS1 data whatever the options (DataBar Expanded)
bool alwaysGS1(const Format &format)
{
    return format.symbology == BARCODE_DBAR_EXP || format.symbology == BARCODE_DBAR_EXPSTK;
}

bool can(const Format &format, unsigned capability)
{
    return ZBarcode_Cap(format.symbology, capability) != 0;
}

//The error of a code of zint (a warning is not one: the symbol is made)
void check(int code, zint_symbol *symbol)
{
    if (code < ZINT_ERROR) return;
    const std::string message = symbol->errtxt[0] ? symbol->errtxt : "zint failed";
    switch (code) {
        case ZINT_ERROR_TOO_LONG:
        case ZINT_ERROR_INVALID_DATA:
        case ZINT_ERROR_INVALID_CHECK:
        case ZINT_ERROR_USES_ECI:
        case ZINT_ERROR_NONCOMPLIANT:
            throw BarcodeError(ErrorCode::Content, message);
        case ZINT_ERROR_INVALID_OPTION:
            throw BarcodeError(ErrorCode::Option, message);
        default:
            throw BarcodeError(ErrorCode::Internal, message);
    }
}

void writePng(void *context, void *data, int size)
{
    auto *png = static_cast<std::vector<uint8_t> *>(context);
    png->insert(png->end(), static_cast<uint8_t *>(data), static_cast<uint8_t *>(data) + size);
}

}

void checkGenerateRequest(const GenerateRequest &request)
{
    const Format &format = *request.format;
    const std::string name = format.name;
    if (!request.errorLetter.empty() || request.errorLevel >= 0) {
        if (format.errorCorrection == ErrorCorrection::None) throw BarcodeError(ErrorCode::Option, name + " takes no errorCorrection");
        if (format.errorCorrection == ErrorCorrection::Letters) {
            if (request.errorLetter.size() != 1 || !std::strchr(format.letters, request.errorLetter[0])) throw BarcodeError(ErrorCode::Option, "The errorCorrection of " + name + " is one of the letters " + format.letters);
        } else if (request.errorLevel < format.levelFrom || request.errorLevel > format.levelTo) {
            throw BarcodeError(ErrorCode::Option, "The errorCorrection of " + name + " is a level from " + std::to_string(format.levelFrom) + " to " + std::to_string(format.levelTo));
        }
    }
    if (request.version != 0) {
        if (format.versions == 0) throw BarcodeError(ErrorCode::Option, name + " takes no version");
        if (request.version < 1 || request.version > format.versions) throw BarcodeError(ErrorCode::Option, "The version of " + name + " is from 1 to " + std::to_string(format.versions));
    }
    if (request.gs1 && !alwaysGS1(format) && !format.gs1Symbology && !can(format, ZINT_CAP_GS1)) throw BarcodeError(ErrorCode::Option, name + " takes no GS1 data");
    if (request.eci != 0 && !can(format, ZINT_CAP_ECI)) throw BarcodeError(ErrorCode::Option, name + " takes no eci");
    if (!request.addOn.empty() && !can(format, ZINT_CAP_EANUPC)) throw BarcodeError(ErrorCode::Option, name + " takes no addOn");
    if (request.binary && (request.gs1 || alwaysGS1(format))) throw BarcodeError(ErrorCode::Option, "GS1 data is text, not bytes");
}

GenerateResult generate(const GenerateRequest &request)
{
    const Format &format = *request.format;
    std::unique_ptr<zint_symbol, void (*)(zint_symbol *)> owner(ZBarcode_Create(), ZBarcode_Delete);
    zint_symbol *symbol = owner.get();
    if (symbol == nullptr) throw BarcodeError(ErrorCode::Internal, "zint failed to allocate a symbol");
    const bool gs1 = request.gs1 || alwaysGS1(format);
    symbol->symbology = gs1 && format.gs1Symbology ? format.gs1Symbology : format.symbology;
    //Text in UTF-8 (zint chooses its character set, an ECI when it needs one), bytes as they are, GS1 data with its
    //application identifiers in brackets or in parentheses
    symbol->input_mode = request.binary ? DATA_MODE : UNICODE_MODE;
    if (gs1) {
        if (!format.gs1Symbology && !alwaysGS1(format)) symbol->input_mode = GS1_MODE;
        if (!request.content.empty() && request.content[0] == '(') symbol->input_mode |= GS1PARENS_MODE;
    }
    //zint's scale 1 is a module of 2 pixels
    symbol->scale = static_cast<float>(request.scale / 2);
    if (request.height > 0) symbol->height = static_cast<float>(request.height);
    if (request.quietZone < 0) {
        symbol->output_options |= BARCODE_QUIET_ZONES;
    } else {
        symbol->output_options |= BARCODE_NO_QUIET_ZONES;
        symbol->whitespace_width = request.quietZone;
        symbol->whitespace_height = request.quietZone;
    }
    symbol->show_hrt = request.showText ? 1 : 0;
    if (!request.foreground.empty()) std::strncpy(symbol->fgcolour, request.foreground.c_str(), sizeof(symbol->fgcolour) - 1);
    if (!request.background.empty()) std::strncpy(symbol->bgcolour, request.background.c_str(), sizeof(symbol->bgcolour) - 1);
    if (format.errorCorrection == ErrorCorrection::Letters && !request.errorLetter.empty()) {
        //QR Code and Micro QR Code: L 1, M 2, Q 3, H 4; rMQR Code: M 2, H 4
        static const char *const order = "LMQH";
        symbol->option_1 = static_cast<int>(std::strchr(order, request.errorLetter[0]) - order) + 1;
    } else if (format.errorCorrection == ErrorCorrection::Level && request.errorLevel >= 0) {
        symbol->option_1 = request.errorLevel;
    }
    if (request.version != 0) symbol->option_2 = request.version;
    symbol->eci = request.eci;
    std::vector<uint8_t> content = request.content;
    if (!request.addOn.empty()) {
        content.push_back('+');
        content.insert(content.end(), request.addOn.begin(), request.addOn.end());
    }
    check(ZBarcode_Encode(symbol, content.data(), static_cast<int>(content.size())), symbol);
    GenerateResult result;
    result.type = request.output;
    if (request.output == "svg") {
        symbol->output_options |= BARCODE_MEMORY_FILE;
        std::strcpy(symbol->outfile, "barcode.svg");
        check(ZBarcode_Print(symbol, request.rotate), symbol);
        result.data.assign(symbol->memfile, symbol->memfile + symbol->memfile_size);
        return result;
    }
    check(ZBarcode_Buffer(symbol, request.rotate), symbol);
    const int width = symbol->bitmap_width;
    const int height = symbol->bitmap_height;
    const size_t pixels = static_cast<size_t>(width) * height;
    //Gray when the colors are black and white (the ones by default), RGB with colors, RGBA with transparency
    const int channels = symbol->alphamap ? 4 : (request.foreground.empty() && request.background.empty() ? 1 : 3);
    std::vector<uint8_t> image(pixels * channels);
    for (size_t i = 0; i < pixels; i++) {
        const uint8_t *rgb = symbol->bitmap + i * 3;
        uint8_t *to = image.data() + i * channels;
        if (channels == 1) {
            to[0] = rgb[0];
        } else {
            to[0] = rgb[0];
            to[1] = rgb[1];
            to[2] = rgb[2];
            if (channels == 4) to[3] = symbol->alphamap[i];
        }
    }
    result.width = width;
    result.height = height;
    result.channels = channels;
    if (request.output == "raw") {
        result.data = std::move(image);
    } else if (!stbi_write_png_to_func(writePng, &result.data, width, height, channels, image.data(), width * channels)) {
        throw BarcodeError(ErrorCode::Internal, "The PNG could not be written");
    }
    return result;
}

}
