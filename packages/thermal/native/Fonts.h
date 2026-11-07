//The fonts of the addon: the files registered (shared by the threads, never removed), and in each thread of the pool its
//own FreeType library and faces (a face cannot be used by two threads at once) with the sized fonts litehtml asks for
//and their glyphs, rendered in monochrome with hinting (crisp 1-bit glyphs, the dot grid of the printer)
#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

#include <ft2build.h>
#include FT_FREETYPE_H

namespace thermal {

//The family of the bundled fonts, the one of the generic families and of the characters a font lacks
constexpr const char *DEFAULT_FAMILY = "noto sans sc";

//A font file registered
struct FontFile {
    //Lowercase
    std::string family;
    int weight = 400;
    bool italic = false;
    std::shared_ptr<const std::string> data;
    long index = 0;
};

//Register a font: its data is read by FreeType to check it (ThermalError Font when it is not a font). Returns its id
size_t registerFont(FontFile file);

//The fonts registered
std::vector<FontFile> registeredFonts();

//A glyph of a sized font: its advance and its 1-bit bitmap (rows of `pitch` bytes, the high bit first)
struct Glyph {
    int advance = 0;
    int left = 0;
    int top = 0;
    int width = 0;
    int height = 0;
    int pitch = 0;
    std::vector<uint8_t> bits;
};

//A face at a size, emboldened or slanted when the file lacks the weight or the style asked for
struct SizedFace {
    FT_Face face = nullptr;
    FT_Size size = nullptr;
    bool embolden = false;
    bool oblique = false;
};

//A font at a size in dots: its faces (the one matched, then the bundled ones for the characters it lacks), its metrics
//in dots, its decorations, its glyphs
class Font {
public:
    Font() = default;
    Font(const Font &) = delete;
    Font &operator=(const Font &) = delete;
    ~Font();

    int px = 0;
    int ascent = 0;
    int descent = 0;
    int height = 0;
    int xHeight = 0;
    int digitWidth = 0;
    int decorations = 0;
    int decorationThickness = 1;
    std::vector<SizedFace> faces;

    //The glyph of a character, rendered the first time
    const Glyph &glyph(char32_t character);

    //The width of a text in dots
    int width(const std::u32string &text);

private:
    std::unordered_map<char32_t, Glyph> glyphs_;
};

//The fonts of the thread: the sized font of a family list (CSS font-family), a weight, a style and a size in dots
Font &fontOf(const std::string &families, int weight, bool italic, int px, int decorations);

//At the start of a rendering: the sized fonts of the thread dropped when there are many (a document holds its fonts while
//it lives: never during a rendering)
void trimFonts();

//UTF-8 to code points (an invalid byte is U+FFFD)
std::u32string utf32Of(const char *text);

}
