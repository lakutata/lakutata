//The errors of the addon: a code the TypeScript side turns into the exception of the package, and a message
#pragma once

#include <stdexcept>
#include <string>

namespace barcode {

enum class ErrorCode {
    //The content cannot be encoded in the format (zint refuses it): BarcodeContentException
    Content,
    //An option does not apply to the format, or its value is out of the range of the format: BarcodeOptionException
    Option,
    //The image cannot be decoded, or it is too large: BarcodeImageException
    Image,
    //The operation was cancelled before it started: BarcodeCancelledException
    Cancelled,
    //The operation took longer than its timeout before it started: BarcodeTimeoutException
    Timeout,
    //An argument the TypeScript side should have checked: BarcodeException
    Argument,
    //An error of the addon itself: BarcodeException
    Internal
};

class BarcodeError : public std::runtime_error {
public:
    BarcodeError(ErrorCode code, const std::string &message) : std::runtime_error(message), code_(code) {}

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
        case ErrorCode::Content: return "content";
        case ErrorCode::Option: return "option";
        case ErrorCode::Image: return "image";
        case ErrorCode::Cancelled: return "cancelled";
        case ErrorCode::Timeout: return "timeout";
        case ErrorCode::Argument: return "argument";
        case ErrorCode::Internal: return "internal";
    }
    return "internal";
}

}
