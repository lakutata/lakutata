#include "Errors.h"

#include <new>
#include <symengine/symengine_exception.h>

namespace math {

const char *codeName(ErrorCode code)
{
    switch (code) {
        case ErrorCode::Syntax: return "E_MATH_SYNTAX";
        case ErrorCode::UnknownFunction: return "E_MATH_UNKNOWN_FUNCTION";
        case ErrorCode::Definition: return "E_MATH_DEFINITION";
        case ErrorCode::Domain: return "E_MATH_DOMAIN";
        case ErrorCode::DivisionByZero: return "E_MATH_DIVISION_BY_ZERO";
        case ErrorCode::NotSupported: return "E_MATH_NOT_SUPPORTED";
        case ErrorCode::Unit: return "E_MATH_UNIT";
        case ErrorCode::Cancelled: return "E_MATH_CANCELLED";
        case ErrorCode::Timeout: return "E_MATH_TIMEOUT";
        case ErrorCode::Argument: return "E_MATH_ARGUMENT";
        case ErrorCode::Internal: return "E_MATH_INTERNAL";
    }
    return "E_MATH_INTERNAL";
}

MathError::MathError(ErrorCode code, const std::string &message, long position)
    : std::runtime_error(message), code_(code), position_(position)
{
}

ErrorCode MathError::code() const
{
    return code_;
}

long MathError::position() const
{
    return position_;
}

ErrorInfo currentErrorInfo()
{
    try {
        throw;
    } catch (const MathError &error) {
        return {error.code(), error.what(), error.position()};
    } catch (SymEngine::SymEngineException &error) {
        switch (error.error_code()) {
            case SYMENGINE_DIV_BY_ZERO: return {ErrorCode::DivisionByZero, error.what(), -1};
            case SYMENGINE_NOT_IMPLEMENTED: return {ErrorCode::NotSupported, error.what(), -1};
            case SYMENGINE_DOMAIN_ERROR: return {ErrorCode::Domain, error.what(), -1};
            case SYMENGINE_PARSE_ERROR: return {ErrorCode::Syntax, error.what(), -1};
            default: return {ErrorCode::Internal, error.what(), -1};
        }
    } catch (const std::bad_alloc &) {
        return {ErrorCode::Internal, "Out of memory", -1};
    } catch (const std::exception &error) {
        return {ErrorCode::Internal, error.what(), -1};
    } catch (...) {
        return {ErrorCode::Internal, "Unknown error", -1};
    }
}

Napi::Error toError(Napi::Env env, const ErrorInfo &info)
{
    Napi::Error error = Napi::Error::New(env, info.message);
    error.Set("code", codeName(info.code));
    if (info.position >= 0) error.Set("position", Napi::Number::New(env, static_cast<double>(info.position)));
    return error;
}

Napi::Error currentError(Napi::Env env)
{
    return toError(env, currentErrorInfo());
}

}
