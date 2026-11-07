#include "Png.h"

#include <cstdlib>
#include <cstring>

#if defined(_MSC_VER)
#pragma warning(push, 0)
#elif defined(__GNUC__) || defined(__clang__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wunused-function"
#pragma GCC diagnostic ignored "-Wmissing-field-initializers"
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"
#endif
#define STB_IMAGE_WRITE_STATIC
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "plutovg-stb-image-write.h"
#if defined(_MSC_VER)
#pragma warning(pop)
#elif defined(__GNUC__) || defined(__clang__)
#pragma GCC diagnostic pop
#endif

#include "Errors.h"

namespace thermal {

namespace {

uint32_t crc32Of(const uint8_t *data, size_t length, uint32_t crc = 0)
{
    static uint32_t table[256];
    static bool built = false;
    if (!built) {
        for (uint32_t n = 0; n < 256; n++) {
            uint32_t c = n;
            for (int k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
            table[n] = c;
        }
        built = true;
    }
    crc = ~crc;
    for (size_t i = 0; i < length; i++) crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >> 8);
    return ~crc;
}

void bigEndian(std::vector<uint8_t> &out, uint32_t value)
{
    out.push_back(static_cast<uint8_t>(value >> 24));
    out.push_back(static_cast<uint8_t>(value >> 16));
    out.push_back(static_cast<uint8_t>(value >> 8));
    out.push_back(static_cast<uint8_t>(value));
}

void chunk(std::vector<uint8_t> &out, const char *type, const uint8_t *data, size_t length)
{
    bigEndian(out, static_cast<uint32_t>(length));
    const size_t start = out.size();
    out.insert(out.end(), type, type + 4);
    if (length) out.insert(out.end(), data, data + length);
    bigEndian(out, crc32Of(out.data() + start, length + 4));
}

}

std::vector<uint8_t> png(const uint8_t *rows, int width, int height)
{
    const int bytes = (width + 7) / 8;
    //The scanlines: a filter byte (none) and the row, white as 1
    std::vector<uint8_t> raw(static_cast<size_t>(bytes + 1) * height);
    for (int y = 0; y < height; y++) {
        uint8_t *line = raw.data() + static_cast<size_t>(y) * (bytes + 1);
        line[0] = 0;
        for (int i = 0; i < bytes; i++) line[i + 1] = static_cast<uint8_t>(~rows[static_cast<size_t>(y) * bytes + i]);
        //The bits past the width are white
        if (width % 8) line[bytes] |= static_cast<uint8_t>(0xFF >> (width % 8));
    }
    int compressedLength = 0;
    unsigned char *compressed = stbi_zlib_compress(raw.data(), static_cast<int>(raw.size()), &compressedLength, 8);
    if (!compressed) throw ThermalError(ErrorCode::Internal, "The PNG cannot be compressed");
    std::vector<uint8_t> out = {0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'};
    std::vector<uint8_t> header;
    bigEndian(header, static_cast<uint32_t>(width));
    bigEndian(header, static_cast<uint32_t>(height));
    //1 bit, grayscale, deflate, adaptive filtering, no interlace
    header.insert(header.end(), {1, 0, 0, 0, 0});
    chunk(out, "IHDR", header.data(), header.size());
    chunk(out, "IDAT", compressed, static_cast<size_t>(compressedLength));
    chunk(out, "IEND", nullptr, 0);
    STBIW_FREE(compressed);
    return out;
}

}
