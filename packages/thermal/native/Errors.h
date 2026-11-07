//The errors of the addon: a code the TypeScript side turns into the exception of the package, and a message
#pragma once

#include <stdexcept>
#include <string>

namespace thermal {

enum class ErrorCode {
    //An argument the TypeScript side should have checked: ThermalException
    Argument,
    //A font cannot be read or is not a font FreeType opens: ThermalFontException
    Font,
    //A resource of the content (an image, a style sheet) cannot be read or decoded: ThermalContentException
    Content,
    //The content is longer than the limit of the rendering: ThermalContentException
    Size,
    //The operation was cancelled before it started: ThermalCancelledException
    Cancelled,
    //The operation took longer than its timeout before it started: ThermalTimeoutException
    Timeout,
    //An error of the addon itself: ThermalException
    Internal
};

class ThermalError : public std::runtime_error {
public:
    ThermalError(ErrorCode code, const std::string &message) : std::runtime_error(message), code_(code) {}

    ErrorCode code() const
    {
        return code_;
    }

private:
    ErrorCode code_;
};

//The name of a code, as the TypeScript side knows it
inline const char *errorCodeName(ErrorCode code)
{
    switch (code) {
        case ErrorCode::Argument: return "argument";
        case ErrorCode::Font: return "font";
        case ErrorCode::Content: return "content";
        case ErrorCode::Size: return "size";
        case ErrorCode::Cancelled: return "cancelled";
        case ErrorCode::Timeout: return "timeout";
        case ErrorCode::Internal: return "internal";
    }
    return "internal";
}

}
