//The container of litehtml: the layout is in CSS pixels (1/96 inch), the drawing in the printer's dots (the dots of a
//CSS pixel: dots per millimetre × 25.4 / 96), every position snapped to whole dots. Fonts come from Fonts.h, pictures and
//style sheets from Resources.h, the line breaking from Breaks.h; everything is drawn on a Canvas.
#pragma once

#include <litehtml.h>

#include "Canvas.h"
#include "Resources.h"

namespace thermal {

class Container : public litehtml::document_container {
public:
    //The resources of the page, the dots of a CSS pixel, the width of the page in dots, the language of the text
    Container(Resources &resources, double scale, int width, std::string language);

    //The canvas drawn on (set once the height of the layout is known)
    void setCanvas(Canvas *canvas)
    {
        canvas_ = canvas;
    }

    litehtml::uint_ptr create_font(const litehtml::font_description &description, const litehtml::document *document, litehtml::font_metrics *metrics) override;
    void delete_font(litehtml::uint_ptr) override {}
    litehtml::pixel_t text_width(const char *text, litehtml::uint_ptr font) override;
    void draw_text(litehtml::uint_ptr, const char *text, litehtml::uint_ptr font, litehtml::web_color color, const litehtml::position &position) override;
    litehtml::pixel_t pt_to_px(float pt) const override;
    litehtml::pixel_t get_default_font_size() const override;
    const char *get_default_font_name() const override;
    void draw_list_marker(litehtml::uint_ptr, const litehtml::list_marker &marker) override;
    void load_image(const char *source, const char *, bool) override;
    void get_image_size(const char *source, const char *, litehtml::size &size) override;
    void draw_image(litehtml::uint_ptr, const litehtml::background_layer &layer, const std::string &url, const std::string &) override;
    void draw_solid_fill(litehtml::uint_ptr, const litehtml::background_layer &layer, const litehtml::web_color &color) override;
    void draw_linear_gradient(litehtml::uint_ptr, const litehtml::background_layer &layer, const litehtml::background_layer::linear_gradient &gradient) override;
    void draw_radial_gradient(litehtml::uint_ptr, const litehtml::background_layer &layer, const litehtml::background_layer::radial_gradient &gradient) override;
    void draw_conic_gradient(litehtml::uint_ptr, const litehtml::background_layer &layer, const litehtml::background_layer::conic_gradient &gradient) override;
    void draw_borders(litehtml::uint_ptr, const litehtml::borders &borders, const litehtml::position &position, bool) override;
    void set_caption(const char *) override {}
    void set_base_url(const char *) override {}
    void link(const std::shared_ptr<litehtml::document> &, const litehtml::element::ptr &) override {}
    void on_anchor_click(const char *, const litehtml::element::ptr &) override {}
    void on_mouse_event(const litehtml::element::ptr &, litehtml::mouse_event) override {}
    void set_cursor(const char *) override {}
    void transform_text(litehtml::string &text, litehtml::text_transform transform) override;
    void import_css(litehtml::string &text, const litehtml::string &url, litehtml::string &) override;
    void set_clip(const litehtml::position &position, const litehtml::border_radiuses &) override;
    void del_clip() override;
    void get_viewport(litehtml::position &viewport) const override;
    litehtml::element::ptr create_element(const char *, const litehtml::string_map &, const std::shared_ptr<litehtml::document> &) override
    {
        return nullptr;
    }
    void get_media_features(litehtml::media_features &media) const override;
    void get_language(litehtml::string &language, litehtml::string &culture) const override;
    void split_text(const char *text, const std::function<void(const char *)> &onWord, const std::function<void(const char *)> &onSpace) override;

private:
    //A length in CSS pixels in dots
    int dots(litehtml::pixel_t pixels) const;

    //A box in CSS pixels in dots: its edges snapped
    Box boxOf(const litehtml::position &position) const;

    //Fill the box of a layer (its rounded corners) with a color or a paint, inside its clip box
    void fillLayer(const litehtml::background_layer &layer, const std::function<void(plutovg_canvas_t *)> *source, const litehtml::web_color *color);

    Resources &resources_;
    double scale_;
    int width_;
    std::string language_;
    Canvas *canvas_ = nullptr;
};

}
