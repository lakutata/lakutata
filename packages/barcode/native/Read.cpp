#include "Read.h"

#include <algorithm>

#include "Barcode.h"
#include "Errors.h"
#include "Formats.h"
#include "ReadBarcode.h"
#include "codecs/WuffsConfig.h"
#include "wuffs-v0.4.c"

namespace barcode {

namespace {

//The callbacks of the decoding: non-premultiplied BGRA, the images larger than MAX_PIXELS refused before their pixels
//are allocated
class Callbacks : public wuffs_aux::DecodeImageCallbacks {
public:
    wuffs_base__pixel_format SelectPixfmt(const wuffs_base__image_config &) override
    {
        return wuffs_base__make_pixel_format(WUFFS_BASE__PIXEL_FORMAT__BGRA_NONPREMUL);
    }

    AllocPixbufResult AllocPixbuf(const wuffs_base__image_config &config, bool allowUninitializedMemory) override
    {
        const uint64_t pixels = static_cast<uint64_t>(config.pixcfg.width()) * config.pixcfg.height();
        if (pixels > MAX_PIXELS) return AllocPixbufResult(std::string("The image has more than 50000000 pixels"));
        return wuffs_aux::DecodeImageCallbacks::AllocPixbuf(config, allowUninitializedMemory);
    }
};

//An encoded image to gray pixels, its transparency over white (the background of the barcodes printed or shown)
std::vector<uint8_t> decode(const std::vector<uint8_t> &image, int &width, int &height)
{
    Callbacks callbacks;
    wuffs_aux::sync_io::MemoryInput input(image.data(), image.size());
    wuffs_aux::DecodeImageResult decoded = wuffs_aux::DecodeImage(callbacks, input,
        wuffs_aux::DecodeImageArgQuirks::DefaultValue(),
        wuffs_aux::DecodeImageArgFlags::DefaultValue(),
        wuffs_aux::DecodeImageArgPixelBlend::DefaultValue(),
        wuffs_aux::DecodeImageArgBackgroundColor::DefaultValue(),
        wuffs_aux::DecodeImageArgMaxInclDimension(1 << 16));
    //A partial success (a truncated file) is refused too
    if (!decoded.error_message.empty()) throw BarcodeError(ErrorCode::Image, "The image cannot be decoded: " + decoded.error_message);
    width = static_cast<int>(decoded.pixbuf.pixcfg.width());
    height = static_cast<int>(decoded.pixbuf.pixcfg.height());
    const wuffs_base__table_u8 plane = decoded.pixbuf.plane(0);
    std::vector<uint8_t> gray(static_cast<size_t>(width) * height);
    for (int y = 0; y < height; y++) {
        const uint8_t *row = plane.ptr + static_cast<size_t>(y) * plane.stride;
        for (int x = 0; x < width; x++) {
            const uint8_t *bgra = row + static_cast<size_t>(x) * 4;
            //Rec. 601 luma, then over white by its alpha
            const unsigned luma = (bgra[2] * 299u + bgra[1] * 587u + bgra[0] * 114u) / 1000u;
            const unsigned alpha = bgra[3];
            gray[static_cast<size_t>(y) * width + x] = static_cast<uint8_t>((luma * alpha + 255u * (255u - alpha)) / 255u);
        }
    }
    return gray;
}

}

std::vector<ReadResult> read(const ReadRequest &request)
{
    ZXing::Barcodes barcodes;
    if (request.raw) {
        if (static_cast<uint64_t>(request.width) * request.height > MAX_PIXELS) throw BarcodeError(ErrorCode::Image, "The image has more than 50000000 pixels");
        const ZXing::ImageFormat format = request.channels == 1 ? ZXing::ImageFormat::Lum : request.channels == 3 ? ZXing::ImageFormat::RGB : ZXing::ImageFormat::RGBA;
        barcodes = ZXing::ReadBarcodes(ZXing::ImageView(request.image.data(), static_cast<int>(request.image.size()), request.width, request.height, format), request.options);
    } else {
        int width = 0;
        int height = 0;
        const std::vector<uint8_t> gray = decode(request.image, width, height);
        barcodes = ZXing::ReadBarcodes(ZXing::ImageView(gray.data(), static_cast<int>(gray.size()), width, height, ZXing::ImageFormat::Lum), request.options);
    }
    std::vector<ReadResult> results;
    for (const ZXing::Barcode &barcode : barcodes) {
        //zxing-cpp may give an empty symbol of no format (an ISBN looked for alone in a pure image)
        if (!barcode.isValid() || barcode.format() == ZXing::BarcodeFormat::None) continue;
        ReadResult result;
        result.format = nameOfRead(barcode.format());
        result.text = barcode.text();
        result.bytes = barcode.bytes();
        const ZXing::Position &position = barcode.position();
        const ZXing::PointI corners[4] = {position.topLeft(), position.topRight(), position.bottomRight(), position.bottomLeft()};
        for (int i = 0; i < 4; i++) {
            result.position[i * 2] = corners[i].x;
            result.position[i * 2 + 1] = corners[i].y;
        }
        result.orientation = barcode.orientation();
        result.errorCorrectionLevel = barcode.ecLevel();
        result.version = barcode.version();
        result.symbologyIdentifier = barcode.symbologyIdentifier();
        result.addOn = barcode.extra(ZXing::BarcodeExtra::EanAddOn);
        result.gs1 = barcode.contentType() == ZXing::ContentType::GS1;
        result.mirrored = barcode.isMirrored();
        result.inverted = barcode.isInverted();
        if (barcode.isPartOfSequence()) {
            result.sequenceIndex = barcode.sequenceIndex();
            result.sequenceSize = barcode.sequenceSize();
            result.sequenceId = barcode.sequenceId();
        }
        //The add-on of an EAN/UPC on its own (zxing-cpp appends it to the content), as the option of the generation
        if (!result.addOn.empty() && result.text.size() > result.addOn.size() && result.text.compare(result.text.size() - result.addOn.size(), result.addOn.size(), result.addOn) == 0) {
            result.text.resize(result.text.size() - result.addOn.size());
            if (result.bytes.size() >= result.addOn.size()) result.bytes.resize(result.bytes.size() - result.addOn.size());
        }
        results.push_back(std::move(result));
    }
    //An EAN/UPC with an add-on is also read without it, by the lines of the image the add-on does not cross: the read
    //without it is dropped
    std::vector<ReadResult> kept;
    for (const ReadResult &result : results) {
        const bool alsoWithAddOn = result.addOn.empty() && std::any_of(results.begin(), results.end(), [&result](const ReadResult &other) {
            return !other.addOn.empty() && other.format == result.format && other.text == result.text;
        });
        if (!alsoWithAddOn) kept.push_back(result);
    }
    return kept;
}

}
