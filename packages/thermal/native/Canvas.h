//The page being drawn: the luminance of each dot (0 black, 255 white) and whether the dot is fixed (drawn black or white
//on purpose: glyphs, vector graphics, solid fills of black or white). At the end the dots not fixed (photographs,
//gradients, gray fills) are dithered, their error never spreading into a fixed dot; the fixed ones are kept as they are.
//Shapes are filled with crisp edges: their coverage is thresholded at one half, never anti-aliased into gray.
#pragma once

#include <cstdint>
#include <functional>
#include <vector>

#include <plutovg.h>

namespace thermal {

//A rectangle in dots
struct Box {
    int x = 0;
    int y = 0;
    int width = 0;
    int height = 0;

    Box intersect(const Box &other) const;
    bool empty() const
    {
        return width <= 0 || height <= 0;
    }
};

//A color: 0-255 components, alpha 255 opaque
struct Color {
    uint8_t red = 0;
    uint8_t green = 0;
    uint8_t blue = 0;
    uint8_t alpha = 255;

    int luminance() const
    {
        return (red * 299 + green * 587 + blue * 114) / 1000;
    }
};

//How the pixels of a picture become dots: dithered (photographs) or thresholded (line art, logos, codes)
enum class Halftone { Dither, Threshold };

class Canvas {
public:
    Canvas(int width, int height);

    int width() const
    {
        return width_;
    }

    int height() const
    {
        return height_;
    }

    //The clip of the drawing (overflow), the whole page when none
    void pushClip(const Box &box);
    void popClip();

    //A dot of a glyph: black or white, fixed
    void dot(int x, int y, bool black);

    //A shape filled with a color: the shape draws its path on a plutovg canvas translated to its box (fill or stroke)
    void paint(const Box &bounds, const std::function<void(plutovg_canvas_t *)> &shape, const Color &color);

    //A shape filled with a paint of plutovg (a gradient), set by `source` on the canvas of the box
    void paint(const Box &bounds, const std::function<void(plutovg_canvas_t *)> &shape, const std::function<void(plutovg_canvas_t *)> &source);

    //A picture (premultiplied ARGB, the format of plutovg) drawn into a box at its size
    void picture(const Box &box, const uint8_t *argb, int stride, Halftone halftone);

    //The dots: 1 black, 0 white, a byte each
    std::vector<uint8_t> dots() const;

private:
    //The current clip
    Box clip() const;

    //The coverage of a shape over a box: 1 where the shape covers at least half of the dot
    std::vector<uint8_t> coverage(const Box &box, const std::function<void(plutovg_canvas_t *)> &shape) const;

    //Set a dot to a luminance over its current one, with an opacity
    void blend(int x, int y, int luminance, int alpha, bool fixed);

    int width_;
    int height_;
    std::vector<uint8_t> luminance_;
    std::vector<uint8_t> fixed_;
    std::vector<Box> clips_;
};

}
