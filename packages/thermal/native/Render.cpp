#include "Render.h"

#include <algorithm>
#include <cmath>

#include <litehtml.h>

#include "Canvas.h"
#include "Container.h"
#include "Errors.h"
#include "Fonts.h"
#include "Resources.h"

namespace thermal {

namespace {

//A page of dots (a byte each) rotated clockwise
std::vector<uint8_t> rotated(const std::vector<uint8_t> &dots, int width, int height, int rotate, int &newWidth, int &newHeight)
{
    if (rotate == 0) {
        newWidth = width;
        newHeight = height;
        return dots;
    }
    std::vector<uint8_t> result(dots.size());
    if (rotate == 180) {
        newWidth = width;
        newHeight = height;
        for (int y = 0; y < height; y++)
            for (int x = 0; x < width; x++) result[static_cast<size_t>(height - 1 - y) * width + (width - 1 - x)] = dots[static_cast<size_t>(y) * width + x];
        return result;
    }
    newWidth = height;
    newHeight = width;
    for (int y = 0; y < height; y++)
        for (int x = 0; x < width; x++) {
            //90: the left edge becomes the top one; 270: the right edge does
            const int nx = rotate == 90 ? height - 1 - y : y;
            const int ny = rotate == 90 ? x : width - 1 - x;
            result[static_cast<size_t>(ny) * newWidth + nx] = dots[static_cast<size_t>(y) * width + x];
        }
    return result;
}

//Dots (a byte each) packed into rows of bits
std::vector<uint8_t> packed(const std::vector<uint8_t> &dots, int width, int height)
{
    const int bytes = (width + 7) / 8;
    std::vector<uint8_t> rows(static_cast<size_t>(bytes) * height, 0);
    for (int y = 0; y < height; y++)
        for (int x = 0; x < width; x++)
            if (dots[static_cast<size_t>(y) * width + x]) rows[static_cast<size_t>(y) * bytes + x / 8] |= static_cast<uint8_t>(0x80 >> (x % 8));
    return rows;
}

}

std::vector<Page> render(const RenderRequest &request)
{
    if (request.width <= 0 || request.width > 32768) throw ThermalError(ErrorCode::Argument, "The width of the page is 1 to 32768 dots");
    trimFonts();
    std::vector<std::string> svgs;
    const std::string html = extractSvgs(request.html, svgs);
    Resources resources(request.baseDirectory, request.scale, std::move(svgs));
    Container container(resources, request.scale, request.width, request.language);
    const litehtml::document::ptr document = litehtml::document::createFromString(html, &container, litehtml::master_css, request.userStyles);
    if (!document) throw ThermalError(ErrorCode::Internal, "The HTML cannot be laid out");
    document->render(static_cast<litehtml::pixel_t>(request.width / request.scale));
    const int content = std::max(1, static_cast<int>(std::ceil(document->height() * request.scale)));
    if (content > request.maxLength) throw ThermalError(ErrorCode::Size, "The content is " + std::to_string(content) + " dots long, longer than the limit of " + std::to_string(request.maxLength) + " dots");
    //The pages: as long as the content on a roll; of the length of the media otherwise
    const int area = request.pageLength > 0 ? request.pageLength : content;
    const int pages = request.pageLength > 0 && request.paginate ? std::max(1, (content + area - 1) / area) : 1;
    const int drawn = pages * area;
    Canvas canvas(request.width, drawn);
    container.setCanvas(&canvas);
    const litehtml::position clip(0, 0, static_cast<litehtml::pixel_t>(request.width / request.scale), static_cast<litehtml::pixel_t>(drawn / request.scale));
    document->draw(0, 0, 0, &clip);
    const std::vector<uint8_t> dots = canvas.dots();
    std::vector<Page> result;
    for (int index = 0; index < pages; index++) {
        const std::vector<uint8_t> page(dots.begin() + static_cast<size_t>(index) * area * request.width, dots.begin() + static_cast<size_t>(index + 1) * area * request.width);
        int width = 0;
        int height = 0;
        std::vector<uint8_t> turned = rotated(page, request.width, area, request.rotate, width, height);
        //The lead: blank rows at the top, along the feed
        if (request.lead > 0) turned.insert(turned.begin(), static_cast<size_t>(request.lead) * width, 0);
        Page output;
        output.width = width;
        output.height = height + request.lead;
        output.rows = packed(turned, output.width, output.height);
        result.push_back(std::move(output));
    }
    return result;
}

}
