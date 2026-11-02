//The generation of a barcode by zint: its content and options, checked against its format, then its image (PNG, SVG
//or the pixels)
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "Formats.h"

namespace barcode {

struct GenerateRequest {
    const Format *format = nullptr;
    //The content: UTF-8 text, or bytes given as they are (binary)
    std::vector<uint8_t> content;
    bool binary = false;
    //"png", "svg" or "raw"
    std::string output = "png";
    //Pixels by module
    double scale = 4;
    //The height of the bars of a linear format, in modules (0: the one of the format)
    double height = 0;
    //The quiet zones: -1 the ones of the standard, else a margin of that many modules
    int quietZone = -1;
    bool showText = true;
    //"RRGGBB" or "RRGGBBAA", empty for black on white
    std::string foreground;
    std::string background;
    int rotate = 0;
    //The error correction: a letter, or a level (-1: none given)
    std::string errorLetter;
    int errorLevel = -1;
    //0: chosen by the size of the content
    int version = 0;
    bool gs1 = false;
    int eci = 0;
    std::string addOn;
};

struct GenerateResult {
    //"png", "svg" or "raw"
    std::string type;
    //The PNG, the SVG (UTF-8), or the pixels (rows of width * channels bytes)
    std::vector<uint8_t> data;
    int width = 0;
    int height = 0;
    //1: gray, 3: RGB, 4: RGBA
    int channels = 0;
};

//Check the options against the format: throws BarcodeError(Option) for an option of the symbol (error correction,
//version, GS1, ECI, add-on) the format does not take or out of its range; the options of the presentation (text,
//height, quiet zones) are ignored by the formats without them
void checkGenerateRequest(const GenerateRequest &request);

//Make the barcode: throws BarcodeError(Content) when zint refuses the content
GenerateResult generate(const GenerateRequest &request);

}
