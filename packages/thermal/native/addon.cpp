//The addon of @lakutata/thermal (the empty build: every library linked, their versions)
#include <napi.h>

#include <ft2build.h>
#include FT_FREETYPE_H
#include <litehtml.h>
#include <lunasvg.h>
#include <plutovg.h>
extern "C" {
#include "linebreak.h"
#include "unibreakbase.h"
}

#include <string>

namespace thermal {

Napi::Value Versions(const Napi::CallbackInfo &info)
{
    Napi::Object versions = Napi::Object::New(info.Env());
    FT_Library library;
    FT_Int major = 0, minor = 0, patch = 0;
    if (FT_Init_FreeType(&library) == 0) {
        FT_Library_Version(library, &major, &minor, &patch);
        FT_Done_FreeType(library);
    }
    versions.Set("freetype", std::to_string(major) + "." + std::to_string(minor) + "." + std::to_string(patch));
    versions.Set("plutovg", plutovg_version_string());
    versions.Set("lunasvg", lunasvg_version_string());
    versions.Set("libunibreak", std::to_string(unibreak_version >> 8) + "." + std::to_string(unibreak_version & 0xFF));
    init_linebreak();
    const char *text = "a b";
    char breaks[3];
    set_linebreaks_utf8(reinterpret_cast<const utf8_t *>(text), 3, "en", breaks);
    versions.Set("litehtml", std::string("0.10 (") + std::to_string(std::string(litehtml::master_css).size()) + " bytes of master CSS)");
    return versions;
}

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    exports.Set("versions", Napi::Function::New(env, Versions));
    return exports;
}

}

static Napi::Object InitThermal(Napi::Env env, Napi::Object exports)
{
    return thermal::Init(env, exports);
}

NODE_API_MODULE(thermal, InitThermal)
