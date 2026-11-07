#include "Fonts.h"

#include <algorithm>
#include <cctype>
#include <mutex>

#include FT_SIZES_H
#include FT_SYNTHESIS_H

#include "Errors.h"

namespace thermal {

namespace {

std::mutex registryMutex;
std::vector<FontFile> registry;

//The generic families of CSS: all of them are the bundled font
bool isGeneric(const std::string &family)
{
    static const char *generics[] = {"sans-serif", "serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif",
        "ui-serif", "ui-monospace", "math", "emoji", "fangsong"};
    for (const char *generic : generics) if (family == generic) return true;
    return false;
}

//The families of a font-family list: lowercase, unquoted, the generic ones as the bundled one
std::vector<std::string> familiesOf(const std::string &list)
{
    std::vector<std::string> families;
    size_t start = 0;
    while (start <= list.size()) {
        size_t end = list.find(',', start);
        if (end == std::string::npos) end = list.size();
        std::string family = list.substr(start, end - start);
        const size_t first = family.find_first_not_of(" \t\r\n\"'");
        const size_t last = family.find_last_not_of(" \t\r\n\"'");
        family = first == std::string::npos ? "" : family.substr(first, last - first + 1);
        std::transform(family.begin(), family.end(), family.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        if (!family.empty()) families.push_back(isGeneric(family) ? DEFAULT_FAMILY : family);
        start = end + 1;
    }
    families.push_back(DEFAULT_FAMILY);
    return families;
}

//The file of a family closest to a weight and a style (CSS font matching, simplified: the style first, then the
//nearest weight, the heavier one on a tie for the bold weights), -1 when the family has none
long bestOf(const std::vector<FontFile> &files, const std::string &family, int weight, bool italic)
{
    long best = -1;
    int bestScore = 0;
    for (size_t id = 0; id < files.size(); id++) {
        const FontFile &file = files[id];
        if (file.family != family) continue;
        int score = (file.italic == italic ? 0 : 10000) + std::abs(file.weight - weight) * 2;
        if (file.weight != weight && (file.weight > weight) != (weight >= 500)) score += 1;
        if (best < 0 || score < bestScore) {
            best = static_cast<long>(id);
            bestScore = score;
        }
    }
    return best;
}

//The FreeType state of a thread of the pool
struct ThreadState {
    FT_Library library = nullptr;
    std::vector<FontFile> files;
    std::vector<FT_Face> faces;
    std::unordered_map<std::string, std::unique_ptr<Font>> fonts;

    ~ThreadState()
    {
        fonts.clear();
        for (FT_Face face : faces) if (face) FT_Done_Face(face);
        if (library) FT_Done_FreeType(library);
    }

    //The files registered since the last call: known to the thread
    void refresh()
    {
        if (!library && FT_Init_FreeType(&library) != 0) throw ThermalError(ErrorCode::Internal, "FreeType cannot be initialized");
        std::lock_guard<std::mutex> lock(registryMutex);
        if (files.size() == registry.size()) return;
        files = registry;
        faces.resize(files.size(), nullptr);
    }

    FT_Face face(size_t id)
    {
        if (!faces[id]) {
            const FontFile &file = files[id];
            if (FT_New_Memory_Face(library, reinterpret_cast<const FT_Byte *>(file.data->data()), static_cast<FT_Long>(file.data->size()), file.index, &faces[id]) != 0) {
                faces[id] = nullptr;
                throw ThermalError(ErrorCode::Font, "The font of the family " + file.family + " cannot be opened");
            }
        }
        return faces[id];
    }
};

ThreadState &threadState()
{
    thread_local ThreadState state;
    return state;
}

int ceil26(FT_Pos value)
{
    return static_cast<int>((value + 63) >> 6);
}

}

size_t registerFont(FontFile file)
{
    FT_Library library;
    if (FT_Init_FreeType(&library) != 0) throw ThermalError(ErrorCode::Internal, "FreeType cannot be initialized");
    FT_Face face;
    const FT_Error error = FT_New_Memory_Face(library, reinterpret_cast<const FT_Byte *>(file.data->data()), static_cast<FT_Long>(file.data->size()), file.index, &face);
    if (error == 0) FT_Done_Face(face);
    FT_Done_FreeType(library);
    if (error != 0) throw ThermalError(ErrorCode::Font, "Not a font FreeType can open (FreeType error " + std::to_string(error) + ")");
    std::transform(file.family.begin(), file.family.end(), file.family.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    std::lock_guard<std::mutex> lock(registryMutex);
    registry.push_back(std::move(file));
    return registry.size() - 1;
}

std::vector<FontFile> registeredFonts()
{
    std::lock_guard<std::mutex> lock(registryMutex);
    return registry;
}

Font::~Font()
{
    for (SizedFace &face : faces) if (face.size) FT_Done_Size(face.size);
}

const Glyph &Font::glyph(char32_t character)
{
    auto found = glyphs_.find(character);
    if (found != glyphs_.end()) return found->second;
    Glyph glyph;
    //The first face holding the character, else the missing glyph of the first one
    const SizedFace *chosen = &faces.front();
    FT_UInt index = 0;
    for (const SizedFace &face : faces) {
        index = FT_Get_Char_Index(face.face, character);
        if (index != 0) {
            chosen = &face;
            break;
        }
    }
    FT_Activate_Size(chosen->size);
    FT_Face face = chosen->face;
    if (FT_Load_Glyph(face, index, FT_LOAD_TARGET_MONO) == 0) {
        FT_GlyphSlot slot = face->glyph;
        if (chosen->oblique && slot->format == FT_GLYPH_FORMAT_OUTLINE) FT_GlyphSlot_Oblique(slot);
        if (chosen->embolden) FT_GlyphSlot_Embolden(slot);
        if (slot->format == FT_GLYPH_FORMAT_BITMAP || FT_Render_Glyph(slot, FT_RENDER_MODE_MONO) == 0) {
            const FT_Bitmap &bitmap = slot->bitmap;
            glyph.advance = static_cast<int>((slot->advance.x + 32) >> 6);
            glyph.left = slot->bitmap_left;
            glyph.top = slot->bitmap_top;
            glyph.width = static_cast<int>(bitmap.width);
            glyph.height = static_cast<int>(bitmap.rows);
            if (bitmap.pixel_mode == FT_PIXEL_MODE_MONO) {
                glyph.pitch = std::abs(bitmap.pitch);
                glyph.bits.resize(static_cast<size_t>(glyph.pitch) * glyph.height);
                for (int row = 0; row < glyph.height; row++) {
                    //A negative pitch: the rows from the bottom
                    const unsigned char *source = bitmap.pitch >= 0 ? bitmap.buffer + static_cast<size_t>(row) * bitmap.pitch : bitmap.buffer + static_cast<size_t>(glyph.height - 1 - row) * glyph.pitch;
                    std::copy(source, source + glyph.pitch, glyph.bits.begin() + static_cast<size_t>(row) * glyph.pitch);
                }
            } else if (bitmap.pixel_mode == FT_PIXEL_MODE_GRAY) {
                //An embedded gray bitmap: thresholded
                glyph.pitch = (glyph.width + 7) / 8;
                glyph.bits.assign(static_cast<size_t>(glyph.pitch) * glyph.height, 0);
                for (int row = 0; row < glyph.height; row++)
                    for (int column = 0; column < glyph.width; column++)
                        if (bitmap.buffer[row * bitmap.pitch + column] >= 128) glyph.bits[static_cast<size_t>(row) * glyph.pitch + column / 8] |= static_cast<uint8_t>(0x80 >> (column % 8));
            } else {
                glyph.width = glyph.height = 0;
            }
        }
    }
    return glyphs_.emplace(character, std::move(glyph)).first->second;
}

int Font::width(const std::u32string &text)
{
    int width = 0;
    for (char32_t character : text) width += glyph(character).advance;
    return width;
}

Font &fontOf(const std::string &families, int weight, bool italic, int px, int decorations)
{
    ThreadState &state = threadState();
    state.refresh();
    const std::string key = families + '\x1f' + std::to_string(weight) + '\x1f' + (italic ? "i" : "n") + '\x1f' + std::to_string(px) + '\x1f' + std::to_string(decorations);
    auto found = state.fonts.find(key);
    if (found != state.fonts.end()) return *found->second;
    //The chain: the family matched, the bundled font at that weight and style, the bundled regular
    std::vector<long> chain;
    for (const std::string &family : familiesOf(families)) {
        const long best = bestOf(state.files, family, weight, italic);
        if (best >= 0) {
            chain.push_back(best);
            break;
        }
    }
    for (long fallback : {bestOf(state.files, DEFAULT_FAMILY, weight, italic), bestOf(state.files, DEFAULT_FAMILY, 400, false)})
        if (fallback >= 0 && std::find(chain.begin(), chain.end(), fallback) == chain.end()) chain.push_back(fallback);
    if (chain.empty()) throw ThermalError(ErrorCode::Font, "No font is registered");
    auto font = std::make_unique<Font>();
    font->px = std::max(1, px);
    font->decorations = decorations;
    for (long id : chain) {
        const FontFile &file = state.files[static_cast<size_t>(id)];
        SizedFace sized;
        sized.face = state.face(static_cast<size_t>(id));
        if (FT_New_Size(sized.face, &sized.size) != 0) throw ThermalError(ErrorCode::Font, "The font of the family " + file.family + " cannot be sized");
        FT_Activate_Size(sized.size);
        FT_Set_Pixel_Sizes(sized.face, 0, static_cast<FT_UInt>(font->px));
        sized.embolden = weight >= 600 && file.weight < 600;
        sized.oblique = italic && !file.italic;
        font->faces.push_back(sized);
    }
    const FT_Size_Metrics &metrics = font->faces.front().size->metrics;
    font->ascent = ceil26(metrics.ascender);
    font->descent = ceil26(-metrics.descender);
    font->height = std::max(ceil26(metrics.height), font->ascent + font->descent);
    font->xHeight = font->glyph(U'x').top;
    font->digitWidth = font->glyph(U'0').advance;
    font->decorationThickness = std::max(1, font->px / 14);
    return *state.fonts.emplace(key, std::move(font)).first->second;
}

void trimFonts()
{
    ThreadState &state = threadState();
    if (state.fonts.size() > 256) state.fonts.clear();
}

std::u32string utf32Of(const char *text)
{
    std::u32string result;
    const auto *p = reinterpret_cast<const unsigned char *>(text);
    while (*p) {
        char32_t code;
        int extra;
        if (*p < 0x80) {
            code = *p;
            extra = 0;
        } else if ((*p >> 5) == 6) {
            code = *p & 0x1F;
            extra = 1;
        } else if ((*p >> 4) == 14) {
            code = *p & 0x0F;
            extra = 2;
        } else if ((*p >> 3) == 30) {
            code = *p & 0x07;
            extra = 3;
        } else {
            result += U'�';
            p++;
            continue;
        }
        p++;
        int read = 0;
        for (; read < extra && (*p & 0xC0) == 0x80; read++, p++) code = (code << 6) | (*p & 0x3F);
        result += read == extra ? code : U'�';
    }
    return result;
}

}
