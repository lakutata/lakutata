//The helpers of the functions of the decimals (DecimalFunctions.cpp, DecimalSpecial.cpp)
#pragma once

#include <algorithm>
#include <cstdlib>
#include <functional>
#include <mutex>
#include <new>
#include <string>

#include "Decimal.h"
#include "../core/Errors.h"

namespace math {

//A constant of the process (π, ln 10) at the most digits computed so far, fewer digits its rounding: an operation runs
//on any thread of the pool, a constant of each thread was computed again on each one
class SharedConstant {
public:
    //The constant at the digits of a context, computed with guard digits more when it has not as many: a quarter more
    //than it had at least (the decimals of an expression are computed again with a few more digits each time)
    Decimal at(const DecimalContext &context, long guard, const std::function<Decimal(const DecimalContext &)> &compute)
    {
        long had = 0;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (digits_ >= context.digits() + guard) return context.round(value_);
            had = digits_;
        }
        const DecimalContext g(std::max(context.digits() + guard, had + had / 4));
        const Decimal value = compute(g);
        std::lock_guard<std::mutex> lock(mutex_);
        if (g.digits() > digits_) {
            value_ = value;
            digits_ = g.digits();
        }
        return context.round(value);
    }

private:
    std::mutex mutex_;
    Decimal value_;
    long digits_ = 0;
};

//The size below which a term of a series is neglected: below the last guard digit of a sum of order 1
inline Decimal negligible(const DecimalContext &g)
{
    return g.parse("1e-" + std::to_string(g.digits() + 2));
}

//The digits of a decimal above its point (0 for |a| < 1)
inline int64_t integerDigits(const DecimalContext &context, const Decimal &a)
{
    const int64_t exponent = context.exponent(a);
    return exponent == DecimalContext::ZERO_EXPONENT || exponent < 0 ? 0 : exponent + 1;
}

//The digits a small decimal loses to an addition of 1 (asinh(a), atanh(a) of a small a): its exponent below 0
inline int64_t smallDigits(const DecimalContext &context, const Decimal &a)
{
    const int64_t exponent = context.exponent(a);
    return exponent == DecimalContext::ZERO_EXPONENT || exponent >= 0 ? 0 : -exponent;
}

inline long long smallInteger(const Decimal &a)
{
    uint32_t status = 0;
    const int64_t value = mpd_qget_i64(a.get(), &status);
    if (status) throw MathError(ErrorCode::Internal, "A decimal is not a small integer");
    return value;
}

//A real value that is not real (MathError Domain): the complex evaluator computes the node instead
class NotRealError : public MathError {
public:
    explicit NotRealError(const std::string &why) : MathError(ErrorCode::Domain, "The value is not a real number (" + why + ")")
    {
    }
};

[[noreturn]] inline void notReal(const std::string &why)
{
    throw NotRealError(why);
}

//The nearest double to a decimal (an infinity beyond the doubles)
inline double toDouble(const Decimal &a)
{
    char *text = mpd_to_sci(a.get(), 0);
    if (!text) throw std::bad_alloc();
    const double value = std::strtod(text, nullptr);
    mpd_free(text);
    return value;
}

//Whether a decimal is an integer
inline bool isInteger(const Decimal &a)
{
    return mpd_isinteger(a.get());
}

//Whether a decimal is 0 or a negative integer: a pole of gamma
inline bool isPole(const DecimalContext &context, const Decimal &a)
{
    return isInteger(a) && !context.isZero(a) ? context.isNegative(a) : context.isZero(a);
}

}
