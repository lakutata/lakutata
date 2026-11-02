//The reading of the barcodes of an image by zxing-cpp: an encoded image decoded by wuffs (PNG, JPEG, GIF, BMP, WebP,
//TGA), or pixels
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "ReaderOptions.h"

namespace barcode {

//The pixels of an image at most: an image larger is refused before its pixels are decoded (an image of a few bytes can
//declare billions of pixels)
constexpr uint64_t MAX_PIXELS = 50'000'000;

struct ReadRequest {
    //An encoded image, or pixels (raw)
    std::vector<uint8_t> image;
    bool raw = false;
    int width = 0;
    int height = 0;
    //The pixels: 1 gray, 3 RGB, 4 RGBA
    int channels = 0;
    ZXing::ReaderOptions options;
};

struct ReadResult {
    std::string format;
    std::string text;
    std::vector<uint8_t> bytes;
    //topLeft, topRight, bottomRight, bottomLeft: x, y
    int position[8] = {};
    int orientation = 0;
    std::string errorCorrectionLevel;
    std::string version;
    std::string symbologyIdentifier;
    std::string addOn;
    bool gs1 = false;
    bool mirrored = false;
    bool inverted = false;
    //A symbol of a structured append: its index, the number of symbols, the id of the sequence (-1: none)
    int sequenceIndex = -1;
    int sequenceSize = -1;
    std::string sequenceId;
};

//The barcodes of the image: throws BarcodeError(Image) when the image cannot be decoded or is too large
std::vector<ReadResult> read(const ReadRequest &request);

}
