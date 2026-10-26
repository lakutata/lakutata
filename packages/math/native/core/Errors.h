//The errors of the addon: a code and a message, thrown in JavaScript as an Error with a `code` (and a `position` for
//the errors of syntax), which src/lib/Native.ts turns into the exceptions of the package
#pragma once

#include <napi.h>
#include <stdexcept>
#include <string>

namespace math {

enum class ErrorCode {
    Syntax,
    UnknownFunction,
    Definition,
    Domain,
    DivisionByZero,
    NotSupported,
    Unit,
    Cancelled,
    Timeout,
    Argument,
    Internal
};

//The name of a code in JavaScript: E_MATH_SYNTAX…
const char *codeName(ErrorCode code);

class MathError : public std::runtime_error {
public:
    //An error; the position of a syntax error is the index of the character in the text (UTF-16, as JavaScript counts)
    MathError(ErrorCode code, const std::string &message, long position = -1);

    ErrorCode code() const;

    long position() const;

private:
    ErrorCode code_;
    long position_;
};

//The JavaScript error of the exception being handled (in a catch): the errors of the addon, of SymEngine, of the
//standard library
Napi::Error currentError(Napi::Env env);

//The code and the message of the exception being handled, for the threads that cannot make JavaScript values
struct ErrorInfo {
    ErrorCode code;
    std::string message;
    long position;
};

ErrorInfo currentErrorInfo();

//The JavaScript error of an ErrorInfo
Napi::Error toError(Napi::Env env, const ErrorInfo &info);

//A function of the addon: its C++ exceptions thrown in JavaScript as errors with a code (an exception crossing
//Node-API would end the process)
template <Napi::Value (*F)(const Napi::CallbackInfo &)>
Napi::Value guarded(const Napi::CallbackInfo &info)
{
    try {
        return F(info);
    } catch (const Napi::Error &) {
        throw;
    } catch (...) {
        throw currentError(info.Env());
    }
}

}
