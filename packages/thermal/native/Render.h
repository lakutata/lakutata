//A rendering: the HTML laid out at the width of the page, drawn on a canvas of dots, dithered, cut into pages (fixed
//length media), each page rotated (wristbands print along the band) and packed into rows of bits
#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace thermal {

struct RenderRequest {
    std::string html;
    //The width of the layout in dots (along the band for a rotated wristband)
    int width = 0;
    //The dots of a CSS pixel (dots per millimetre × 25.4 / 96)
    double scale = 1;
    //The length of a page of the layout in dots (0: a continuous roll, one page as long as the content)
    int pageLength = 0;
    //More content than a page: more pages (else the content beyond the first page is cut)
    bool paginate = false;
    //The rows left blank at the top of each page once rotated: the start of the media the printer cannot print, along
    //its feed (the layout is shorter by it)
    int lead = 0;
    //The rotation of each page: 0, 90, 180, 270 (clockwise)
    int rotate = 0;
    //The longest content in dots (a guard against a runaway page)
    int maxLength = 20000;
    //The directory the files of the page are read from (empty: none)
    std::string baseDirectory;
    //The language of the text (its line breaking)
    std::string language = "zh";
    //The style sheet of the rendering, after the master one of litehtml and before the page's own
    std::string userStyles;
};

//A page: its size in dots and its rows, (width + 7) / 8 bytes each, the high bit the leftmost dot, 1 black
struct Page {
    int width = 0;
    int height = 0;
    std::vector<uint8_t> rows;
};

std::vector<Page> render(const RenderRequest &request);

}
