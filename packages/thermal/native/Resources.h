//The resources of a page: the pictures of its <img> and backgrounds, the style sheets it links. A source is an inline
//<svg> of the page (taken out of the HTML: litehtml draws no SVG), a data: URL (base64 or percent-encoded; PNG, JPEG,
//GIF, BMP, SVG), a qrcode: URL (a QR code drawn on whole dots), or a file of the base directory given (never outside
//it). Remote sources (http:, https:) are refused. A picture's fragment chooses its halftone (#threshold, #dither).
#pragma once

#include <map>
#include <memory>
#include <string>
#include <vector>

#include <plutovg.h>

#include "Canvas.h"

namespace lunasvg {
class Document;
}

namespace thermal {

//A picture of the page
class Picture {
public:
    virtual ~Picture() = default;

    //Its own size in CSS pixels
    double width = 0;
    double height = 0;

    //Draw it into a box of dots
    virtual void draw(Canvas &canvas, const Box &box) const = 0;
};

class Resources {
public:
    //The base directory of the files (empty: no file is read), the dots of a CSS pixel, the inline SVGs of the page
    Resources(std::string baseDirectory, double scale, std::vector<std::string> inlineSvgs);
    ~Resources();

    //The picture of a source, loaded the first time (ThermalError Content when it cannot be read or decoded)
    const Picture &picture(const std::string &source);

    //The text of a style sheet linked (ThermalError Content when it cannot be read)
    std::string styleSheet(const std::string &source);

private:
    //The bytes of a file of the base directory
    std::string file(const std::string &path);

    std::string baseDirectory_;
    double scale_;
    std::vector<std::string> inlineSvgs_;
    std::map<std::string, std::unique_ptr<Picture>> pictures_;
};

//The inline <svg> elements of an HTML text: each replaced by an <img> whose source names it (inline-svg:N), its class,
//id, style, width and height kept on the <img>
std::string extractSvgs(const std::string &html, std::vector<std::string> &svgs);

}
