#include "Container.h"

#include <algorithm>
#include <cctype>
#include <cmath>

#include "Breaks.h"
#include "Fonts.h"

namespace thermal {

namespace {

//The default size of the text in CSS pixels: about 3 mm, the height of the printers' own 12×24 font at 203 dpi
constexpr litehtml::pixel_t DEFAULT_FONT_SIZE = 12;

//The control point distance of a quarter of a circle drawn by a cubic curve
constexpr float KAPPA = 0.5522847f;

Color colorOf(const litehtml::web_color &color)
{
    return {color.red, color.green, color.blue, color.alpha};
}

//Text prints black unless it is nearly white (gray text stays readable on a printer of black dots)
bool inked(const litehtml::web_color &color)
{
    return color.alpha > 127 && colorOf(color).luminance() < 230;
}

//A rectangle with its four corners rounded (radii in dots, x and y), as the current path
void roundedRect(plutovg_canvas_t *canvas, float x, float y, float width, float height, const float radii[8])
{
    //Radii larger than the sides are scaled down together (CSS)
    float factor = 1;
    const auto fit = [&](float side, float a, float b) {
        if (a + b > side && a + b > 0) factor = std::min(factor, side / (a + b));
    };
    fit(width, radii[0], radii[2]);
    fit(width, radii[6], radii[4]);
    fit(height, radii[1], radii[7]);
    fit(height, radii[3], radii[5]);
    float r[8];
    for (int i = 0; i < 8; i++) r[i] = radii[i] * factor;
    const float right = x + width;
    const float bottom = y + height;
    plutovg_canvas_new_path(canvas);
    plutovg_canvas_move_to(canvas, x + r[0], y);
    plutovg_canvas_line_to(canvas, right - r[2], y);
    if (r[2] > 0 || r[3] > 0) plutovg_canvas_cubic_to(canvas, right - r[2] + r[2] * KAPPA, y, right, y + r[3] - r[3] * KAPPA, right, y + r[3]);
    plutovg_canvas_line_to(canvas, right, bottom - r[5]);
    if (r[4] > 0 || r[5] > 0) plutovg_canvas_cubic_to(canvas, right, bottom - r[5] + r[5] * KAPPA, right - r[4] + r[4] * KAPPA, bottom, right - r[4], bottom);
    plutovg_canvas_line_to(canvas, x + r[6], bottom);
    if (r[6] > 0 || r[7] > 0) plutovg_canvas_cubic_to(canvas, x + r[6] - r[6] * KAPPA, bottom, x, bottom - r[7] + r[7] * KAPPA, x, bottom - r[7]);
    plutovg_canvas_line_to(canvas, x, y + r[1]);
    if (r[0] > 0 || r[1] > 0) plutovg_canvas_cubic_to(canvas, x, y + r[1] - r[1] * KAPPA, x + r[0] - r[0] * KAPPA, y, x + r[0], y);
    plutovg_canvas_close_path(canvas);
}

}

Container::Container(Resources &resources, double scale, int width, std::string language) : resources_(resources), scale_(scale), width_(width), language_(std::move(language)) {}

int Container::dots(litehtml::pixel_t pixels) const
{
    return static_cast<int>(std::lround(pixels * scale_));
}

Box Container::boxOf(const litehtml::position &position) const
{
    const int left = dots(position.x);
    const int top = dots(position.y);
    return {left, top, dots(position.x + position.width) - left, dots(position.y + position.height) - top};
}

litehtml::uint_ptr Container::create_font(const litehtml::font_description &description, const litehtml::document *, litehtml::font_metrics *metrics)
{
    const int px = std::max(1, dots(description.size));
    Font &font = fontOf(description.family, description.weight, description.style == litehtml::font_style_italic, px, description.decoration_line);
    if (metrics) {
        metrics->font_size = description.size;
        metrics->ascent = font.ascent / scale_;
        metrics->descent = font.descent / scale_;
        metrics->height = font.height / scale_;
        metrics->x_height = font.xHeight / scale_;
        metrics->ch_width = font.digitWidth / scale_;
        //The spaces of a decorated text are drawn: its line runs under them
        metrics->draw_spaces = description.decoration_line != litehtml::text_decoration_line_none;
        metrics->sub_shift = font.xHeight / 2.0 / scale_;
        metrics->super_shift = font.xHeight / 2.0 / scale_;
    }
    return reinterpret_cast<litehtml::uint_ptr>(&font);
}

litehtml::pixel_t Container::text_width(const char *text, litehtml::uint_ptr handle)
{
    return reinterpret_cast<Font *>(handle)->width(utf32Of(text)) / scale_;
}

void Container::draw_text(litehtml::uint_ptr, const char *text, litehtml::uint_ptr handle, litehtml::web_color color, const litehtml::position &position)
{
    Font &font = *reinterpret_cast<Font *>(handle);
    const bool black = inked(color);
    const int start = dots(position.x);
    const int baseline = dots(position.y) + font.ascent;
    int x = start;
    for (char32_t character : utf32Of(text)) {
        const Glyph &glyph = font.glyph(character);
        for (int row = 0; row < glyph.height; row++) {
            const uint8_t *bits = glyph.bits.data() + static_cast<size_t>(row) * glyph.pitch;
            for (int column = 0; column < glyph.width; column++)
                if (bits[column >> 3] & (0x80 >> (column & 7))) canvas_->dot(x + glyph.left + column, baseline - glyph.top + row, black);
        }
        x += glyph.advance;
    }
    //The decorations: lines of the thickness of the font, over the advance of the text
    const auto line = [&](int top) {
        for (int y = top; y < top + font.decorationThickness; y++)
            for (int column = start; column < x; column++) canvas_->dot(column, y, black);
    };
    if (font.decorations & litehtml::text_decoration_line_underline) line(baseline + std::max(1, font.descent / 3));
    if (font.decorations & litehtml::text_decoration_line_line_through) line(baseline - font.xHeight / 2);
    if (font.decorations & litehtml::text_decoration_line_overline) line(baseline - font.ascent);
}

litehtml::pixel_t Container::pt_to_px(float pt) const
{
    return pt * 96 / 72;
}

litehtml::pixel_t Container::get_default_font_size() const
{
    return DEFAULT_FONT_SIZE;
}

const char *Container::get_default_font_name() const
{
    return "Noto Sans SC";
}

void Container::draw_list_marker(litehtml::uint_ptr, const litehtml::list_marker &marker)
{
    const Box box = boxOf(marker.pos);
    if (!marker.image.empty()) {
        resources_.picture(marker.image).draw(*canvas_, box);
        return;
    }
    const float cx = box.x + box.width / 2.0f;
    const float cy = box.y + box.height / 2.0f;
    const float radius = std::max(1.0f, std::min(box.width, box.height) / 2.0f);
    const Box bounds{box.x - 1, box.y - 1, box.width + 2, box.height + 2};
    switch (marker.marker_type) {
        case litehtml::list_style_type_circle:
            canvas_->paint(bounds, [&](plutovg_canvas_t *canvas) {
                plutovg_canvas_set_line_width(canvas, std::max(1.0f, radius / 3));
                plutovg_canvas_circle(canvas, cx, cy, radius - std::max(1.0f, radius / 3) / 2);
                plutovg_canvas_stroke(canvas);
            }, colorOf(marker.color));
            break;
        case litehtml::list_style_type_square:
            canvas_->paint(box, [&](plutovg_canvas_t *canvas) {
                plutovg_canvas_rect(canvas, static_cast<float>(box.x), static_cast<float>(box.y), static_cast<float>(box.width), static_cast<float>(box.height));
                plutovg_canvas_fill(canvas);
            }, colorOf(marker.color));
            break;
        case litehtml::list_style_type_none:
            break;
        default:
            canvas_->paint(bounds, [&](plutovg_canvas_t *canvas) {
                plutovg_canvas_circle(canvas, cx, cy, radius);
                plutovg_canvas_fill(canvas);
            }, colorOf(marker.color));
    }
}

void Container::load_image(const char *source, const char *, bool)
{
    resources_.picture(source);
}

void Container::get_image_size(const char *source, const char *, litehtml::size &size)
{
    const Picture &picture = resources_.picture(source);
    size.width = static_cast<litehtml::pixel_t>(picture.width);
    size.height = static_cast<litehtml::pixel_t>(picture.height);
}

void Container::draw_image(litehtml::uint_ptr, const litehtml::background_layer &layer, const std::string &url, const std::string &)
{
    const Picture &picture = resources_.picture(url);
    const Box tile = boxOf(layer.origin_box);
    if (tile.empty()) return;
    canvas_->pushClip(boxOf(layer.clip_box));
    //The tiles of the layer over its clip box (background-repeat)
    const Box clip = boxOf(layer.clip_box);
    const bool repeatX = layer.repeat == litehtml::background_repeat_repeat || layer.repeat == litehtml::background_repeat_repeat_x;
    const bool repeatY = layer.repeat == litehtml::background_repeat_repeat || layer.repeat == litehtml::background_repeat_repeat_y;
    int firstX = tile.x;
    int firstY = tile.y;
    if (repeatX) while (firstX > clip.x) firstX -= tile.width;
    if (repeatY) while (firstY > clip.y) firstY -= tile.height;
    for (int y = firstY; repeatY ? y < clip.y + clip.height : y == firstY; y += tile.height)
        for (int x = firstX; repeatX ? x < clip.x + clip.width : x == firstX; x += tile.width)
            picture.draw(*canvas_, {x, y, tile.width, tile.height});
    canvas_->popClip();
}

void Container::fillLayer(const litehtml::background_layer &layer, const std::function<void(plutovg_canvas_t *)> *source, const litehtml::web_color *color)
{
    const Box box = boxOf(layer.border_box);
    if (box.empty()) return;
    const litehtml::border_radiuses &r = layer.border_radius;
    const float radii[8] = {static_cast<float>(dots(r.top_left_x)), static_cast<float>(dots(r.top_left_y)), static_cast<float>(dots(r.top_right_x)), static_cast<float>(dots(r.top_right_y)),
        static_cast<float>(dots(r.bottom_right_x)), static_cast<float>(dots(r.bottom_right_y)), static_cast<float>(dots(r.bottom_left_x)), static_cast<float>(dots(r.bottom_left_y))};
    const auto shape = [&](plutovg_canvas_t *canvas) {
        roundedRect(canvas, static_cast<float>(box.x), static_cast<float>(box.y), static_cast<float>(box.width), static_cast<float>(box.height), radii);
        plutovg_canvas_fill(canvas);
    };
    canvas_->pushClip(boxOf(layer.clip_box));
    if (source) canvas_->paint(box, shape, *source);
    else canvas_->paint(box, shape, colorOf(*color));
    canvas_->popClip();
}

void Container::draw_solid_fill(litehtml::uint_ptr, const litehtml::background_layer &layer, const litehtml::web_color &color)
{
    if (color.alpha == 0) return;
    fillLayer(layer, nullptr, &color);
}

void Container::draw_linear_gradient(litehtml::uint_ptr, const litehtml::background_layer &layer, const litehtml::background_layer::linear_gradient &gradient)
{
    std::vector<plutovg_gradient_stop_t> stops;
    for (const auto &point : gradient.color_points) stops.push_back({point.offset, {point.color.red / 255.f, point.color.green / 255.f, point.color.blue / 255.f, point.color.alpha / 255.f}});
    const std::function<void(plutovg_canvas_t *)> source = [&](plutovg_canvas_t *canvas) {
        plutovg_canvas_set_linear_gradient(canvas, static_cast<float>(gradient.start.x * scale_), static_cast<float>(gradient.start.y * scale_), static_cast<float>(gradient.end.x * scale_),
            static_cast<float>(gradient.end.y * scale_), PLUTOVG_SPREAD_METHOD_PAD, stops.data(), static_cast<int>(stops.size()), nullptr);
    };
    fillLayer(layer, &source, nullptr);
}

void Container::draw_radial_gradient(litehtml::uint_ptr, const litehtml::background_layer &layer, const litehtml::background_layer::radial_gradient &gradient)
{
    std::vector<plutovg_gradient_stop_t> stops;
    for (const auto &point : gradient.color_points) stops.push_back({point.offset, {point.color.red / 255.f, point.color.green / 255.f, point.color.blue / 255.f, point.color.alpha / 255.f}});
    const float cx = static_cast<float>(gradient.position.x * scale_);
    const float cy = static_cast<float>(gradient.position.y * scale_);
    const float rx = std::max(1.0f, static_cast<float>(gradient.radius.x * scale_));
    const float ry = std::max(1.0f, static_cast<float>(gradient.radius.y * scale_));
    const std::function<void(plutovg_canvas_t *)> source = [&](plutovg_canvas_t *canvas) {
        //An ellipse: a circle of radius rx, scaled vertically about its centre
        plutovg_matrix_t matrix;
        plutovg_matrix_init_translate(&matrix, cx, cy);
        plutovg_matrix_scale(&matrix, 1, ry / rx);
        plutovg_matrix_translate(&matrix, -cx, -cy);
        plutovg_canvas_set_radial_gradient(canvas, cx, cy, rx, cx, cy, 0, PLUTOVG_SPREAD_METHOD_PAD, stops.data(), static_cast<int>(stops.size()), &matrix);
    };
    fillLayer(layer, &source, nullptr);
}

void Container::draw_conic_gradient(litehtml::uint_ptr, const litehtml::background_layer &layer, const litehtml::background_layer::conic_gradient &gradient)
{
    //plutovg has no conic gradient: the layer is filled with the average of its colors
    if (gradient.color_points.empty()) return;
    int red = 0, green = 0, blue = 0, alpha = 0;
    for (const auto &point : gradient.color_points) {
        red += point.color.red;
        green += point.color.green;
        blue += point.color.blue;
        alpha += point.color.alpha;
    }
    const int count = static_cast<int>(gradient.color_points.size());
    const litehtml::web_color average(static_cast<litehtml::byte>(red / count), static_cast<litehtml::byte>(green / count), static_cast<litehtml::byte>(blue / count), static_cast<litehtml::byte>(alpha / count));
    fillLayer(layer, nullptr, &average);
}

void Container::draw_borders(litehtml::uint_ptr, const litehtml::borders &borders, const litehtml::position &position, bool)
{
    const Box box = boxOf(position);
    if (box.empty()) return;
    const auto visible = [](const litehtml::border &border) {
        return border.width > 0 && border.style != litehtml::border_style_none && border.style != litehtml::border_style_hidden && border.color.alpha > 0;
    };
    //The width of a side in whole dots (a visible border is one dot at least)
    const auto widthOf = [&](const litehtml::border &border) { return visible(border) ? std::max(1, dots(border.width)) : 0; };
    const auto dash = [&](plutovg_canvas_t *canvas, const litehtml::border &border, float width) {
        if (border.style == litehtml::border_style_dashed) {
            const float dashes[] = {width * 3, width * 3};
            plutovg_canvas_set_dash_array(canvas, dashes, 2);
        } else if (border.style == litehtml::border_style_dotted) {
            const float dashes[] = {width, width};
            plutovg_canvas_set_dash_array(canvas, dashes, 2);
        }
    };
    const litehtml::border *sides[4] = {&borders.top, &borders.right, &borders.bottom, &borders.left};
    const int widths[4] = {widthOf(borders.top), widthOf(borders.right), widthOf(borders.bottom), widthOf(borders.left)};
    const litehtml::border_radiuses &r = borders.radius;
    const float radii[8] = {static_cast<float>(dots(r.top_left_x)), static_cast<float>(dots(r.top_left_y)), static_cast<float>(dots(r.top_right_x)), static_cast<float>(dots(r.top_right_y)),
        static_cast<float>(dots(r.bottom_right_x)), static_cast<float>(dots(r.bottom_right_y)), static_cast<float>(dots(r.bottom_left_x)), static_cast<float>(dots(r.bottom_left_y))};
    bool alike = widths[0] > 0;
    for (int i = 1; i < 4 && alike; i++) alike = widths[i] == widths[0] && sides[i]->style == sides[0]->style && sides[i]->color == sides[0]->color;
    bool rounded = false;
    for (float radius : radii) rounded = rounded || radius > 0;
    if (alike && (rounded || sides[0]->style == litehtml::border_style_dashed || sides[0]->style == litehtml::border_style_dotted)) {
        //One stroke along the middle of the border, its corners rounded
        const float width = static_cast<float>(widths[0]);
        float inner[8];
        for (int i = 0; i < 8; i++) inner[i] = std::max(0.0f, radii[i] - width / 2);
        canvas_->paint(box, [&](plutovg_canvas_t *canvas) {
            plutovg_canvas_set_line_width(canvas, width);
            dash(canvas, *sides[0], width);
            roundedRect(canvas, box.x + width / 2, box.y + width / 2, box.width - width, box.height - width, inner);
            plutovg_canvas_stroke(canvas);
        }, colorOf(sides[0]->color));
        return;
    }
    //Each side apart: a band (a solid border, its double lines) or a dashed line along its middle
    for (int i = 0; i < 4; i++) {
        const int width = widths[i];
        if (!width) continue;
        const litehtml::border &border = *sides[i];
        Box band;
        if (i == 0) band = {box.x, box.y, box.width, width};
        else if (i == 1) band = {box.x + box.width - width, box.y, width, box.height};
        else if (i == 2) band = {box.x, box.y + box.height - width, box.width, width};
        else band = {box.x, box.y, width, box.height};
        if (border.style == litehtml::border_style_dashed || border.style == litehtml::border_style_dotted) {
            const bool horizontal = i == 0 || i == 2;
            canvas_->paint(band, [&](plutovg_canvas_t *canvas) {
                plutovg_canvas_set_line_width(canvas, static_cast<float>(width));
                dash(canvas, border, static_cast<float>(width));
                if (horizontal) {
                    plutovg_canvas_move_to(canvas, static_cast<float>(band.x), band.y + width / 2.0f);
                    plutovg_canvas_line_to(canvas, static_cast<float>(band.x + band.width), band.y + width / 2.0f);
                } else {
                    plutovg_canvas_move_to(canvas, band.x + width / 2.0f, static_cast<float>(band.y));
                    plutovg_canvas_line_to(canvas, band.x + width / 2.0f, static_cast<float>(band.y + band.height));
                }
                plutovg_canvas_stroke(canvas);
            }, colorOf(border.color));
        } else if (border.style == litehtml::border_style_double && width >= 3) {
            //Two lines of a third of the width each
            const int line = std::max(1, width / 3);
            const bool horizontal = i == 0 || i == 2;
            const Box first = horizontal ? Box{band.x, band.y, band.width, line} : Box{band.x, band.y, line, band.height};
            const Box second = horizontal ? Box{band.x, band.y + band.height - line, band.width, line} : Box{band.x + band.width - line, band.y, line, band.height};
            for (const Box &part : {first, second})
                canvas_->paint(part, [&](plutovg_canvas_t *canvas) {
                    plutovg_canvas_rect(canvas, static_cast<float>(part.x), static_cast<float>(part.y), static_cast<float>(part.width), static_cast<float>(part.height));
                    plutovg_canvas_fill(canvas);
                }, colorOf(border.color));
        } else {
            canvas_->paint(band, [&](plutovg_canvas_t *canvas) {
                plutovg_canvas_rect(canvas, static_cast<float>(band.x), static_cast<float>(band.y), static_cast<float>(band.width), static_cast<float>(band.height));
                plutovg_canvas_fill(canvas);
            }, colorOf(border.color));
        }
    }
}

void Container::transform_text(litehtml::string &text, litehtml::text_transform transform)
{
    //ASCII letters only (the other scripts keep their case)
    bool wordStart = true;
    for (char &c : text) {
        const unsigned char u = static_cast<unsigned char>(c);
        if (transform == litehtml::text_transform_uppercase) c = static_cast<char>(std::toupper(u));
        else if (transform == litehtml::text_transform_lowercase) c = static_cast<char>(std::tolower(u));
        else if (transform == litehtml::text_transform_capitalize) {
            if (wordStart && u < 0x80) c = static_cast<char>(std::toupper(u));
            wordStart = std::isspace(u) != 0;
        }
    }
}

void Container::import_css(litehtml::string &text, const litehtml::string &url, litehtml::string &)
{
    text = resources_.styleSheet(url);
}

void Container::set_clip(const litehtml::position &position, const litehtml::border_radiuses &)
{
    canvas_->pushClip(boxOf(position));
}

void Container::del_clip()
{
    canvas_->popClip();
}

void Container::get_viewport(litehtml::position &viewport) const
{
    viewport = litehtml::position(0, 0, static_cast<litehtml::pixel_t>(width_ / scale_), 100000);
}

void Container::get_media_features(litehtml::media_features &media) const
{
    media.type = litehtml::media_type_print;
    media.width = media.device_width = static_cast<litehtml::pixel_t>(width_ / scale_);
    media.height = media.device_height = 100000;
    media.color = 0;
    media.color_index = 0;
    media.monochrome = 1;
    media.resolution = static_cast<litehtml::pixel_t>(scale_ * 96);
}

void Container::get_language(litehtml::string &language, litehtml::string &culture) const
{
    language = language_;
    culture = "";
}

void Container::split_text(const char *text, const std::function<void(const char *)> &onWord, const std::function<void(const char *)> &onSpace)
{
    splitText(text, language_, [&](const std::string &word) { onWord(word.c_str()); }, [&](const std::string &space) { onSpace(space.c_str()); });
}

}
