//The PNG of a page: 1-bit grayscale (a black dot of the page is 0 in the PNG), its data compressed by the deflate of
//stb_image_write (the copy plutovg vendors, compiled static here)
#pragma once

#include <cstdint>
#include <vector>

namespace thermal {

std::vector<uint8_t> png(const uint8_t *rows, int width, int height);

}
