#include "Canvas.h"

#include <algorithm>

namespace thermal {

namespace {

//The luminances fixed as black or white: nearly black or nearly white, opaque
bool isPure(int luminance)
{
    return luminance < 16 || luminance > 239;
}

}

Box Box::intersect(const Box &other) const
{
    const int left = std::max(x, other.x);
    const int top = std::max(y, other.y);
    const int right = std::min(x + width, other.x + other.width);
    const int bottom = std::min(y + height, other.y + other.height);
    return {left, top, std::max(0, right - left), std::max(0, bottom - top)};
}

Canvas::Canvas(int width, int height) : width_(width), height_(height), luminance_(static_cast<size_t>(width) * height, 255), fixed_(static_cast<size_t>(width) * height, 0) {}

void Canvas::pushClip(const Box &box)
{
    clips_.push_back(box.intersect(clip()));
}

void Canvas::popClip()
{
    if (!clips_.empty()) clips_.pop_back();
}

Box Canvas::clip() const
{
    return clips_.empty() ? Box{0, 0, width_, height_} : clips_.back();
}

void Canvas::dot(int x, int y, bool black)
{
    const Box area = clip();
    if (x < area.x || y < area.y || x >= area.x + area.width || y >= area.y + area.height) return;
    const size_t at = static_cast<size_t>(y) * width_ + x;
    luminance_[at] = black ? 0 : 255;
    fixed_[at] = 1;
}

void Canvas::blend(int x, int y, int luminance, int alpha, bool fixed)
{
    const size_t at = static_cast<size_t>(y) * width_ + x;
    if (alpha >= 255) {
        luminance_[at] = static_cast<uint8_t>(luminance);
        fixed_[at] = fixed ? 1 : 0;
        return;
    }
    luminance_[at] = static_cast<uint8_t>((luminance * alpha + luminance_[at] * (255 - alpha)) / 255);
    fixed_[at] = 0;
}

std::vector<uint8_t> Canvas::coverage(const Box &box, const std::function<void(plutovg_canvas_t *)> &shape) const
{
    std::vector<uint8_t> covered(static_cast<size_t>(box.width) * box.height, 0);
    plutovg_surface_t *surface = plutovg_surface_create(box.width, box.height);
    if (!surface) return covered;
    plutovg_canvas_t *canvas = plutovg_canvas_create(surface);
    plutovg_canvas_translate(canvas, static_cast<float>(-box.x), static_cast<float>(-box.y));
    plutovg_canvas_set_rgba(canvas, 0, 0, 0, 1);
    shape(canvas);
    plutovg_canvas_destroy(canvas);
    const uint8_t *data = plutovg_surface_get_data(surface);
    const int stride = plutovg_surface_get_stride(surface);
    for (int y = 0; y < box.height; y++) {
        const auto *row = reinterpret_cast<const uint32_t *>(data + static_cast<size_t>(y) * stride);
        for (int x = 0; x < box.width; x++) covered[static_cast<size_t>(y) * box.width + x] = (row[x] >> 24) >= 128 ? 1 : 0;
    }
    plutovg_surface_destroy(surface);
    return covered;
}

void Canvas::paint(const Box &bounds, const std::function<void(plutovg_canvas_t *)> &shape, const Color &color)
{
    const Box box = bounds.intersect(clip());
    if (box.empty() || color.alpha == 0) return;
    const std::vector<uint8_t> covered = coverage(box, shape);
    int luminance = color.luminance();
    const bool fixed = color.alpha == 255 && isPure(luminance);
    if (fixed) luminance = luminance < 128 ? 0 : 255;
    for (int y = 0; y < box.height; y++)
        for (int x = 0; x < box.width; x++)
            if (covered[static_cast<size_t>(y) * box.width + x]) blend(box.x + x, box.y + y, luminance, color.alpha, fixed);
}

void Canvas::paint(const Box &bounds, const std::function<void(plutovg_canvas_t *)> &shape, const std::function<void(plutovg_canvas_t *)> &source)
{
    const Box box = bounds.intersect(clip());
    if (box.empty()) return;
    const std::vector<uint8_t> covered = coverage(box, shape);
    //The paint over the whole box (not anti-aliased: a rectangle on whole dots), its colors read where the shape covers
    plutovg_surface_t *surface = plutovg_surface_create(box.width, box.height);
    if (!surface) return;
    plutovg_canvas_t *canvas = plutovg_canvas_create(surface);
    plutovg_canvas_translate(canvas, static_cast<float>(-box.x), static_cast<float>(-box.y));
    source(canvas);
    plutovg_canvas_fill_rect(canvas, static_cast<float>(box.x), static_cast<float>(box.y), static_cast<float>(box.width), static_cast<float>(box.height));
    plutovg_canvas_destroy(canvas);
    const uint8_t *data = plutovg_surface_get_data(surface);
    const int stride = plutovg_surface_get_stride(surface);
    for (int y = 0; y < box.height; y++) {
        const auto *row = reinterpret_cast<const uint32_t *>(data + static_cast<size_t>(y) * stride);
        for (int x = 0; x < box.width; x++) {
            if (!covered[static_cast<size_t>(y) * box.width + x]) continue;
            const uint32_t pixel = row[x];
            const int alpha = static_cast<int>(pixel >> 24);
            if (!alpha) continue;
            //Premultiplied: the color is the components divided by the alpha
            const Color color{static_cast<uint8_t>(((pixel >> 16) & 0xFF) * 255 / alpha), static_cast<uint8_t>(((pixel >> 8) & 0xFF) * 255 / alpha), static_cast<uint8_t>((pixel & 0xFF) * 255 / alpha), static_cast<uint8_t>(alpha)};
            blend(box.x + x, box.y + y, color.luminance(), alpha, false);
        }
    }
    plutovg_surface_destroy(surface);
}

void Canvas::picture(const Box &box, const uint8_t *argb, int stride, Halftone halftone)
{
    const Box area = box.intersect(clip());
    for (int y = area.y; y < area.y + area.height; y++) {
        const auto *row = reinterpret_cast<const uint32_t *>(argb + static_cast<size_t>(y - box.y) * stride);
        for (int x = area.x; x < area.x + area.width; x++) {
            const uint32_t pixel = row[x - box.x];
            const int alpha = static_cast<int>(pixel >> 24);
            if (!alpha) continue;
            //The luminance of the pixel's own color (premultiplied: divided by its alpha)
            const int premultiplied = (static_cast<int>((pixel >> 16) & 0xFF) * 299 + static_cast<int>((pixel >> 8) & 0xFF) * 587 + static_cast<int>(pixel & 0xFF) * 114) / 1000;
            const int own = std::min(255, premultiplied * 255 / alpha);
            if (halftone == Halftone::Threshold) {
                if (alpha >= 128) blend(x, y, own < 128 ? 0 : 255, 255, true);
            } else {
                blend(x, y, own, alpha, false);
            }
        }
    }
}

std::vector<uint8_t> Canvas::dots() const
{
    //Floyd-Steinberg over the dots not fixed: the error of a dot goes to its neighbours not fixed only
    std::vector<int16_t> values(luminance_.begin(), luminance_.end());
    std::vector<uint8_t> dots(values.size(), 0);
    const auto spread = [&](int x, int y, int error, int weight) {
        if (x < 0 || x >= width_ || y >= height_) return;
        const size_t at = static_cast<size_t>(y) * width_ + x;
        if (fixed_[at]) return;
        values[at] = static_cast<int16_t>(values[at] + error * weight / 16);
    };
    for (int y = 0; y < height_; y++) {
        for (int x = 0; x < width_; x++) {
            const size_t at = static_cast<size_t>(y) * width_ + x;
            const int value = values[at];
            const bool black = value < 128;
            dots[at] = black ? 1 : 0;
            if (fixed_[at]) continue;
            const int error = value - (black ? 0 : 255);
            if (!error) continue;
            spread(x + 1, y, error, 7);
            spread(x - 1, y + 1, error, 3);
            spread(x, y + 1, error, 5);
            spread(x + 1, y + 1, error, 1);
        }
    }
    return dots;
}

}
