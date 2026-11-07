#include "Resources.h"

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <sstream>

#include <lunasvg.h>

extern "C" {
#include "qrcodegen.h"
}

#include "Errors.h"

namespace thermal {

namespace {

//The dots of a module of a QR code at its own size
constexpr int QR_MODULE_DOTS = 4;

std::string lowercase(std::string text)
{
    std::transform(text.begin(), text.end(), text.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return text;
}

int hexValue(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

std::string percentDecode(const std::string &text)
{
    std::string result;
    result.reserve(text.size());
    for (size_t i = 0; i < text.size(); i++) {
        if (text[i] == '%' && i + 2 < text.size() && hexValue(text[i + 1]) >= 0 && hexValue(text[i + 2]) >= 0) {
            result += static_cast<char>(hexValue(text[i + 1]) * 16 + hexValue(text[i + 2]));
            i += 2;
        } else {
            result += text[i];
        }
    }
    return result;
}

std::string base64Decode(const std::string &text)
{
    std::string result;
    int value = 0;
    int bits = 0;
    for (char c : text) {
        int digit;
        if (c >= 'A' && c <= 'Z') digit = c - 'A';
        else if (c >= 'a' && c <= 'z') digit = c - 'a' + 26;
        else if (c >= '0' && c <= '9') digit = c - '0' + 52;
        else if (c == '+' || c == '-') digit = 62;
        else if (c == '/' || c == '_') digit = 63;
        else continue;
        value = (value << 6) | digit;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            result += static_cast<char>((value >> bits) & 0xFF);
        }
    }
    return result;
}

//The options of a fragment: name=value pairs and flags separated by &
std::map<std::string, std::string> fragmentOptions(const std::string &fragment)
{
    std::map<std::string, std::string> options;
    std::stringstream stream(fragment);
    std::string item;
    while (std::getline(stream, item, '&')) {
        if (item.empty()) continue;
        const size_t equals = item.find('=');
        if (equals == std::string::npos) options[lowercase(item)] = "";
        else options[lowercase(item.substr(0, equals))] = item.substr(equals + 1);
    }
    return options;
}

Halftone halftoneOf(const std::map<std::string, std::string> &options, Halftone otherwise)
{
    if (options.count("threshold")) return Halftone::Threshold;
    if (options.count("dither")) return Halftone::Dither;
    return otherwise;
}

//A raster picture (PNG, JPEG, GIF, BMP), scaled to its box
class RasterPicture : public Picture {
public:
    RasterPicture(plutovg_surface_t *surface, Halftone halftone) : surface_(surface), halftone_(halftone)
    {
        width = plutovg_surface_get_width(surface);
        height = plutovg_surface_get_height(surface);
    }

    ~RasterPicture() override
    {
        plutovg_surface_destroy(surface_);
    }

    void draw(Canvas &canvas, const Box &box) const override
    {
        if (box.empty()) return;
        plutovg_surface_t *scaled = plutovg_surface_create(box.width, box.height);
        if (!scaled) return;
        plutovg_canvas_t *context = plutovg_canvas_create(scaled);
        plutovg_matrix_t matrix;
        plutovg_matrix_init_scale(&matrix, static_cast<float>(box.width / width), static_cast<float>(box.height / height));
        plutovg_canvas_set_texture(context, surface_, PLUTOVG_TEXTURE_TYPE_PLAIN, 1, &matrix);
        plutovg_canvas_fill_rect(context, 0, 0, static_cast<float>(box.width), static_cast<float>(box.height));
        plutovg_canvas_destroy(context);
        canvas.picture(box, plutovg_surface_get_data(scaled), plutovg_surface_get_stride(scaled), halftone_);
        plutovg_surface_destroy(scaled);
    }

private:
    plutovg_surface_t *surface_;
    Halftone halftone_;
};

//An SVG, rendered at the size of its box
class SvgPicture : public Picture {
public:
    SvgPicture(std::unique_ptr<lunasvg::Document> document, Halftone halftone) : document_(std::move(document)), halftone_(halftone)
    {
        width = document_->width();
        height = document_->height();
    }

    void draw(Canvas &canvas, const Box &box) const override
    {
        if (box.empty()) return;
        lunasvg::Bitmap bitmap = document_->renderToBitmap(box.width, box.height);
        if (bitmap.isNull()) return;
        canvas.picture(box, bitmap.data(), bitmap.stride(), halftone_);
    }

private:
    std::unique_ptr<lunasvg::Document> document_;
    Halftone halftone_;
};

//A QR code: its modules drawn on whole dots, as large as its box allows, centred in it, with its quiet zone
class QrPicture : public Picture {
public:
    QrPicture(std::vector<uint8_t> code, int quiet, double scale) : code_(std::move(code)), quiet_(quiet)
    {
        const int total = qrcodegen_getSize(code_.data()) + 2 * quiet_;
        width = height = total * QR_MODULE_DOTS / scale;
    }

    void draw(Canvas &canvas, const Box &box) const override
    {
        const int size = qrcodegen_getSize(code_.data());
        const int total = size + 2 * quiet_;
        const int module = std::max(1, std::min(box.width, box.height) / total);
        const int side = total * module;
        const int left = box.x + (box.width - side) / 2;
        const int top = box.y + (box.height - side) / 2;
        for (int y = 0; y < side; y++) {
            const int row = y / module - quiet_;
            for (int x = 0; x < side; x++) {
                const int column = x / module - quiet_;
                const bool black = row >= 0 && column >= 0 && row < size && column < size && qrcodegen_getModule(code_.data(), column, row);
                canvas.dot(left + x, top + y, black);
            }
        }
    }

private:
    std::vector<uint8_t> code_;
    int quiet_;
};

//Whether a source names a scheme (data:, http:...): a Windows drive (C:) is a path
bool hasScheme(const std::string &source)
{
    const size_t colon = source.find(':');
    if (colon == std::string::npos || colon < 2) return false;
    for (size_t i = 0; i < colon; i++) {
        const char c = source[i];
        if (!(std::isalnum(static_cast<unsigned char>(c)) || c == '+' || c == '-' || c == '.')) return false;
    }
    return true;
}

}

Resources::Resources(std::string baseDirectory, double scale, std::vector<std::string> inlineSvgs) : baseDirectory_(std::move(baseDirectory)), scale_(scale), inlineSvgs_(std::move(inlineSvgs)) {}

Resources::~Resources() = default;

std::string Resources::file(const std::string &path)
{
    if (baseDirectory_.empty()) throw ThermalError(ErrorCode::Content, "A file is read only from the base directory given (the baseDir option): " + path);
    namespace fs = std::filesystem;
    std::error_code error;
    const fs::path base = fs::weakly_canonical(fs::u8path(baseDirectory_), error);
    if (error) throw ThermalError(ErrorCode::Content, "The base directory cannot be read: " + baseDirectory_);
    const fs::path requested = fs::u8path(path);
    const fs::path resolved = fs::weakly_canonical(requested.is_absolute() ? requested : base / requested, error);
    if (error) throw ThermalError(ErrorCode::Content, "The file cannot be read: " + path);
    //Never outside the base directory (.., a symbolic link out of it)
    const auto [baseEnd, resolvedAt] = std::mismatch(base.begin(), base.end(), resolved.begin(), resolved.end());
    if (baseEnd != base.end()) throw ThermalError(ErrorCode::Content, "The file is outside the base directory: " + path);
    std::ifstream stream(resolved, std::ios::binary);
    if (!stream) throw ThermalError(ErrorCode::Content, "The file cannot be read: " + path);
    std::stringstream content;
    content << stream.rdbuf();
    return content.str();
}

const Picture &Resources::picture(const std::string &source)
{
    auto found = pictures_.find(source);
    if (found != pictures_.end()) return *found->second;
    //The fragment: the options of the picture
    const size_t hash = source.rfind('#');
    const std::string location = hash == std::string::npos ? source : source.substr(0, hash);
    const auto options = fragmentOptions(hash == std::string::npos ? "" : source.substr(hash + 1));
    std::unique_ptr<Picture> picture;
    const auto svgOf = [&](const std::string &text) -> std::unique_ptr<Picture> {
        auto document = lunasvg::Document::loadFromData(text);
        if (!document) throw ThermalError(ErrorCode::Content, "The SVG cannot be read: " + location.substr(0, 64));
        return std::make_unique<SvgPicture>(std::move(document), halftoneOf(options, Halftone::Threshold));
    };
    const auto rasterOf = [&](const std::string &bytes) -> std::unique_ptr<Picture> {
        plutovg_surface_t *surface = plutovg_surface_load_from_image_data(bytes.data(), static_cast<int>(bytes.size()));
        if (!surface) throw ThermalError(ErrorCode::Content, "The image cannot be decoded (PNG, JPEG, GIF or BMP): " + location.substr(0, 64));
        return std::make_unique<RasterPicture>(surface, halftoneOf(options, Halftone::Dither));
    };
    const std::string scheme = hasScheme(location) ? lowercase(location.substr(0, location.find(':'))) : "";
    if (scheme == "inline-svg") {
        const size_t index = std::stoul(location.substr(11));
        if (index >= inlineSvgs_.size()) throw ThermalError(ErrorCode::Internal, "An inline SVG is missing");
        picture = svgOf(inlineSvgs_[index]);
    } else if (scheme == "data") {
        const size_t comma = location.find(',');
        if (comma == std::string::npos) throw ThermalError(ErrorCode::Content, "A data: URL without data");
        const std::string header = lowercase(location.substr(5, comma - 5));
        const std::string payload = location.substr(comma + 1);
        const std::string bytes = header.find(";base64") != std::string::npos ? base64Decode(payload) : percentDecode(payload);
        picture = header.rfind("image/svg+xml", 0) == 0 ? svgOf(bytes) : rasterOf(bytes);
    } else if (scheme == "qrcode") {
        const std::string text = percentDecode(location.substr(7));
        const std::string level = options.count("ec") ? lowercase(options.at("ec")) : "m";
        const qrcodegen_Ecc ecc = level == "l" ? qrcodegen_Ecc_LOW : level == "q" ? qrcodegen_Ecc_QUARTILE : level == "h" ? qrcodegen_Ecc_HIGH : qrcodegen_Ecc_MEDIUM;
        const int quiet = options.count("quiet") ? std::max(0, std::min(16, std::atoi(options.at("quiet").c_str()))) : 4;
        std::vector<uint8_t> code(qrcodegen_BUFFER_LEN_MAX);
        std::vector<uint8_t> temporary(qrcodegen_BUFFER_LEN_MAX);
        if (!qrcodegen_encodeText(text.c_str(), temporary.data(), code.data(), ecc, qrcodegen_VERSION_MIN, qrcodegen_VERSION_MAX, qrcodegen_Mask_AUTO, true))
            throw ThermalError(ErrorCode::Content, "The text is too long for a QR code (" + std::to_string(text.size()) + " bytes)");
        picture = std::make_unique<QrPicture>(std::move(code), quiet, scale_);
    } else if (!scheme.empty()) {
        throw ThermalError(ErrorCode::Content, "Only the data:, qrcode: and file sources are read, not " + scheme + ": (" + location.substr(0, 64) + ")");
    } else {
        const std::string path = percentDecode(location);
        const std::string bytes = file(path);
        picture = lowercase(path).size() > 4 && lowercase(path).substr(path.size() - 4) == ".svg" ? svgOf(bytes) : rasterOf(bytes);
    }
    return *pictures_.emplace(source, std::move(picture)).first->second;
}

std::string Resources::styleSheet(const std::string &source)
{
    if (hasScheme(source)) {
        const std::string scheme = lowercase(source.substr(0, source.find(':')));
        if (scheme != "data") throw ThermalError(ErrorCode::Content, "Only the data: and file style sheets are read, not " + scheme + ": (" + source.substr(0, 64) + ")");
        const size_t comma = source.find(',');
        if (comma == std::string::npos) throw ThermalError(ErrorCode::Content, "A data: URL without data");
        const std::string header = lowercase(source.substr(5, comma - 5));
        return header.find(";base64") != std::string::npos ? base64Decode(source.substr(comma + 1)) : percentDecode(source.substr(comma + 1));
    }
    return file(percentDecode(source));
}

std::string extractSvgs(const std::string &html, std::vector<std::string> &svgs)
{
    std::string result;
    result.reserve(html.size());
    const std::string lower = lowercase(html);
    size_t at = 0;
    const auto isTagEnd = [&](size_t i) { return i >= lower.size() || std::isspace(static_cast<unsigned char>(lower[i])) || lower[i] == '>' || lower[i] == '/'; };
    while (at < html.size()) {
        const size_t comment = lower.find("<!--", at);
        size_t svg = lower.find("<svg", at);
        while (svg != std::string::npos && !isTagEnd(svg + 4)) svg = lower.find("<svg", svg + 4);
        if (svg == std::string::npos) break;
        if (comment != std::string::npos && comment < svg) {
            const size_t end = lower.find("-->", comment + 4);
            const size_t next = end == std::string::npos ? html.size() : end + 3;
            result.append(html, at, next - at);
            at = next;
            continue;
        }
        //The end of the element: its </svg>, the nested <svg> elements counted
        size_t depth = 0;
        size_t scan = svg;
        size_t end = std::string::npos;
        while (scan < lower.size()) {
            const size_t open = lower.find("<svg", scan + 1);
            const size_t close = lower.find("</svg", scan + 1);
            if (close == std::string::npos) break;
            if (open != std::string::npos && open < close && isTagEnd(open + 4)) {
                depth++;
                scan = open;
                continue;
            }
            if (depth == 0) {
                end = lower.find('>', close);
                break;
            }
            depth--;
            scan = close;
        }
        if (end == std::string::npos) break;
        const std::string element = html.substr(svg, end + 1 - svg);
        //The attributes of its start tag kept on the <img>: class, id, style; width and height as styles
        const size_t tagEnd = element.find('>');
        const std::string tag = element.substr(0, tagEnd);
        std::string attributes;
        std::string style;
        size_t i = 4;
        while (i < tag.size()) {
            while (i < tag.size() && (std::isspace(static_cast<unsigned char>(tag[i])) || tag[i] == '/')) i++;
            const size_t nameStart = i;
            while (i < tag.size() && !std::isspace(static_cast<unsigned char>(tag[i])) && tag[i] != '=' && tag[i] != '/') i++;
            const std::string name = lowercase(tag.substr(nameStart, i - nameStart));
            std::string value;
            if (i < tag.size() && tag[i] == '=') {
                i++;
                if (i < tag.size() && (tag[i] == '"' || tag[i] == '\'')) {
                    const char quote = tag[i++];
                    const size_t valueEnd = tag.find(quote, i);
                    value = tag.substr(i, valueEnd == std::string::npos ? std::string::npos : valueEnd - i);
                    i = valueEnd == std::string::npos ? tag.size() : valueEnd + 1;
                } else {
                    const size_t valueStart = i;
                    while (i < tag.size() && !std::isspace(static_cast<unsigned char>(tag[i]))) i++;
                    value = tag.substr(valueStart, i - valueStart);
                }
            }
            if (name.empty()) {
                i++;
                continue;
            }
            //Inside the double quotes of the <img>: a double quote of the value as an entity
            for (size_t quote = value.find('"'); quote != std::string::npos; quote = value.find('"', quote + 6)) value.replace(quote, 1, "&quot;");
            if (name == "class" || name == "id") attributes += " " + name + "=\"" + value + "\"";
            else if (name == "style") style += value + ";";
            else if (name == "width" || name == "height") {
                const bool number = !value.empty() && value.find_first_not_of("0123456789.") == std::string::npos;
                style = name + ":" + value + (number ? "px" : "") + ";" + style;
            }
        }
        if (!style.empty()) attributes += " style=\"" + style + "\"";
        result.append(html, at, svg - at);
        result += "<img src=\"inline-svg:" + std::to_string(svgs.size()) + "\"" + attributes + ">";
        svgs.push_back(element);
        at = end + 1;
    }
    result.append(html, at, std::string::npos);
    return result;
}

}
