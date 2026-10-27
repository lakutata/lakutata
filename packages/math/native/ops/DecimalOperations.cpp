//The operations of the decimals of a precision (the Decimal class of the package): the arguments are read exactly, the
//results correctly rounded to the precision, halves to even
#include "Decimal.h"

#include <algorithm>
#include <functional>

#include "../core/Errors.h"

namespace math {

namespace {

//f computed with more guard digits until two roundings to the digits agree, not within the error of f (a few units
//of its last guard digit: the functions of DecimalFunctions.cpp are within one, mpd_qpow almost always) of a half
//between two of them; a value still within it at the last is at the half, rounded to even
Decimal correctlyRounded(long digits, const std::function<Decimal(const DecimalContext &)> &f)
{
    const DecimalContext target(digits);
    Decimal previous;
    for (long guard = 10;; guard *= 4) {
        const DecimalContext g(digits + guard);
        const Decimal value = f(g);
        const double error = g.isZero(value) ? 0 : static_cast<double>(g.exponent(value) - g.digits() + 3);
        if (guard >= 640) return g.roundAtHalf(value, digits, error);
        const Decimal rounded = target.round(value);
        if (guard > 10 && target.compare(rounded, previous) == 0 && !g.nearHalf(value, digits, error)) return rounded;
        previous = rounded;
    }
}

//An integer argument of an operation (the places of round(), the degree of root()), within ±10^9
long long integerArgument(const Decimal &value, const char *what)
{
    uint32_t status = 0;
    const int64_t integer = mpd_qget_i64(value.get(), &status);
    if (status || !mpd_isinteger(value.get()) || integer > 1000000000 || integer < -1000000000) {
        throw MathError(ErrorCode::Argument, std::string(what) + " is an integer from -1000000000 to 1000000000");
    }
    return integer;
}

//The span of digits of two decimals: from the first digit of the larger to the last digit of either, with a margin
//(the context in which their remainder, their integer quotient and their sum are exact)
int64_t spanOf(const DecimalContext &context, const Decimal &a, const Decimal &b)
{
    int64_t first = 0;
    int64_t last = 0;
    bool any = false;
    for (const Decimal *value : {&a, &b}) {
        if (context.isZero(*value)) continue;
        const int64_t adjusted = context.exponent(*value);
        const int64_t lowest = static_cast<int64_t>(value->get()->exp);
        first = any ? std::max(first, adjusted) : adjusted;
        last = any ? std::min(last, lowest) : lowest;
        any = true;
    }
    return any ? first - last + 3 : 1;
}

//a rounded to a number of places after the point (before it when negative), halves away from zero: exact, then rounded
//to the precision
Decimal roundedTo(const DecimalContext &context, const Decimal &a, long long places)
{
    if (context.isZero(a) || -places <= static_cast<int64_t>(a.get()->exp)) return context.round(a);
    Decimal result;
    uint32_t status = 0;
    mpd_context_t wide;
    mpd_maxcontext(&wide);
    wide.prec = context.digits() + 2;
    wide.round = MPD_ROUND_HALF_UP;
    mpd_qrescale(result.get(), a.get(), static_cast<mpd_ssize_t>(-places), &wide, &status);
    DecimalContext::check(status);
    return context.round(result);
}

//The text of a decimal with a number of places after the point, halves away from zero, its trailing zeros kept
//(toFixed(2) of 1.5 is 1.50); a 0 has no sign
std::string fixedText(const Decimal &a, long long places)
{
    if (places < 0 || places > 100000) throw MathError(ErrorCode::Argument, "The places after the point are from 0 to 100000");
    const DecimalContext probe(1);
    const int64_t first = probe.isZero(a) ? 0 : std::max<int64_t>(probe.exponent(a), 0);
    const int64_t digits = first + places + 2;
    if (digits > 10000000) throw MathError(ErrorCode::NotSupported, "The text of the decimal needs more than 10000000 digits");
    mpd_context_t wide;
    mpd_maxcontext(&wide);
    wide.prec = static_cast<mpd_ssize_t>(digits);
    wide.round = MPD_ROUND_HALF_UP;
    Decimal result;
    uint32_t status = 0;
    mpd_qrescale(result.get(), a.get(), static_cast<mpd_ssize_t>(-places), &wide, &status);
    DecimalContext::check(status);
    if (mpd_iszero(result.get())) mpd_set_positive(result.get());
    char *formatted = mpd_qformat(result.get(), "f", &wide, &status);
    DecimalContext::check(status);
    if (!formatted) throw std::bad_alloc();
    std::string text(formatted);
    mpd_free(formatted);
    return text;
}

//a mod b: the remainder of a/b of the sign of b (a - b floor(a/b)), exact, then rounded to the precision
Decimal modulo(const DecimalContext &context, const Decimal &a, const Decimal &b)
{
    if (context.isZero(b)) throw MathError(ErrorCode::DivisionByZero, "Division by zero (a modulus of 0)");
    if (context.isZero(a)) return context.integer(0);
    const DecimalContext wide(spanOf(context, a, b));
    Decimal remainder;
    uint32_t status = 0;
    mpd_context_t exact;
    mpd_maxcontext(&exact);
    exact.prec = wide.digits();
    mpd_qrem(remainder.get(), a.get(), b.get(), &exact, &status);
    DecimalContext::check(status);
    if (!wide.isZero(remainder) && wide.isNegative(remainder) != wide.isNegative(b)) remainder = wide.add(remainder, b);
    return context.round(remainder);
}

//a^b: 0^0 is 1 (as the formulas), 0 to a negative power a division by zero, a negative number to a non-integer power
//not real
Decimal power(const DecimalContext &context, const Decimal &a, const Decimal &b)
{
    if (context.isZero(a)) {
        if (context.isZero(b)) return context.integer(1);
        if (context.isNegative(b)) throw MathError(ErrorCode::DivisionByZero, "Division by zero (0 to a negative power)");
        return context.integer(0);
    }
    if (context.isNegative(a) && !mpd_isinteger(b.get())) throw MathError(ErrorCode::Domain, "The value is not a real number (a negative number to a non-integer power)");
    return correctlyRounded(context.digits(), [&a, &b](const DecimalContext &g) { return g.pow(a, b); });
}

//The real root of a degree n: the root of |a|, negated for a negative a and an odd degree
Decimal root(const DecimalContext &context, const Decimal &a, long long n)
{
    if (n < 1) throw MathError(ErrorCode::Argument, "The degree of a root is an integer from 1 to 1000000000");
    if (n == 1) return context.round(a);
    if (context.isNegative(a) && n % 2 == 0) throw MathError(ErrorCode::Domain, "The value is not a real number (an even root of a negative number)");
    if (n == 2) return context.sqrt(a);
    if (context.isZero(a)) return context.integer(0);
    const bool negative = context.isNegative(a);
    //e^(ln|a|/n), with the digits of the exponent of a more (ln|a| has them above its point)
    const int64_t first = context.exponent(a);
    const long more = static_cast<long>(std::to_string(first < 0 ? -first : first).size()) + 2;
    const Decimal value = correctlyRounded(context.digits(), [&a, n, more](const DecimalContext &g) {
        const DecimalContext h(g.digits() + more);
        return g.round(h.exp(h.div(h.ln(h.abs(a)), h.integer(n))));
    });
    return negative ? context.neg(value) : value;
}

//log of a in a base: ln(a)/ln(base)
Decimal logarithm(const DecimalContext &context, const Decimal &a, const Decimal &base)
{
    if (context.isZero(a)) throw MathError(ErrorCode::DivisionByZero, "Division by zero (the logarithm of 0)");
    if (context.isNegative(a)) throw MathError(ErrorCode::Domain, "The value is not a real number (the logarithm of a negative number)");
    if (context.isZero(base) || context.isNegative(base)) throw MathError(ErrorCode::Domain, "The base of a logarithm is a positive number other than 1");
    if (context.compare(base, context.integer(1)) == 0) throw MathError(ErrorCode::DivisionByZero, "Division by zero (a logarithm in base 1)");
    return correctlyRounded(context.digits(), [&a, &base](const DecimalContext &g) { return g.div(g.ln(a), g.ln(base)); });
}

}

std::string decimalOperation(const std::string &operation, long precision, const std::vector<std::string> &arguments)
{
    if (precision < 1 || precision > 100000) throw MathError(ErrorCode::Argument, "The precision is from 1 to 100000");
    const DecimalContext context(precision);
    std::vector<Decimal> values;
    for (const std::string &text : arguments) values.push_back(DecimalContext::exact(text));
    const size_t needed = operation == "add" || operation == "sub" || operation == "mul" || operation == "div" || operation == "mod" || operation == "pow" ||
        operation == "root" || operation == "log" || operation == "atan2" || operation == "roundTo" || operation == "fixed" || operation == "compare" ? 2 : 1;
    if (values.size() != needed) throw MathError(ErrorCode::Argument, "The operation " + operation + " of decimals takes " + std::to_string(needed) + " values");
    const Decimal &a = values[0];
    auto text = [&context, precision](const Decimal &value) { return context.text(value, precision); };
    using Unary = Decimal (DecimalContext::*)(const Decimal &) const;
    //The functions within a unit of their last digit, correctly rounded by their guard digits
    auto function = [&context, &a, &text](Unary apply) {
        return text(correctlyRounded(context.digits(), [&a, apply](const DecimalContext &g) { return (g.*apply)(a); }));
    };
    if (operation == "round") return text(context.round(a));
    if (operation == "add") return text(context.add(a, values[1]));
    if (operation == "sub") return text(context.sub(a, values[1]));
    if (operation == "mul") return text(context.mul(a, values[1]));
    if (operation == "div") return text(context.div(a, values[1]));
    if (operation == "mod") return text(modulo(context, a, values[1]));
    if (operation == "pow") return text(power(context, a, values[1]));
    if (operation == "neg") return text(context.neg(a));
    if (operation == "abs") return text(context.abs(a));
    if (operation == "sqrt") {
        if (context.isNegative(a)) throw MathError(ErrorCode::Domain, "The value is not a real number (the square root of a negative number)");
        return text(context.sqrt(a));
    }
    if (operation == "root") return text(root(context, a, integerArgument(values[1], "The degree of a root")));
    //mpdecimal's exp, ln and log10 are correctly rounded
    if (operation == "exp") return text(context.exp(a));
    if (operation == "ln" || operation == "log10") {
        if (context.isZero(a)) throw MathError(ErrorCode::DivisionByZero, "Division by zero (the logarithm of 0)");
        if (context.isNegative(a)) throw MathError(ErrorCode::Domain, "The value is not a real number (the logarithm of a negative number)");
        return text(operation == "ln" ? context.ln(a) : context.log10(a));
    }
    if (operation == "log") return text(logarithm(context, a, values[1]));
    if (operation == "sin") return function(&DecimalContext::sin);
    if (operation == "cos") return function(&DecimalContext::cos);
    if (operation == "tan") return function(&DecimalContext::tan);
    if (operation == "asin") return function(&DecimalContext::asin);
    if (operation == "acos") return function(&DecimalContext::acos);
    if (operation == "atan") return function(&DecimalContext::atan);
    if (operation == "sinh") return function(&DecimalContext::sinh);
    if (operation == "cosh") return function(&DecimalContext::cosh);
    if (operation == "tanh") return function(&DecimalContext::tanh);
    if (operation == "asinh") return function(&DecimalContext::asinh);
    if (operation == "acosh") return function(&DecimalContext::acosh);
    if (operation == "atanh") return function(&DecimalContext::atanh);
    if (operation == "gamma") return function(&DecimalContext::gamma);
    if (operation == "loggamma") return function(&DecimalContext::loggamma);
    if (operation == "erf") return function(&DecimalContext::erf);
    if (operation == "erfc") return function(&DecimalContext::erfc);
    if (operation == "lambertw") return function(&DecimalContext::lambertw);
    if (operation == "digamma") return text(correctlyRounded(context.digits(), [&a](const DecimalContext &g) { return g.polygamma(0, a); }));
    if (operation == "zeta") return text(correctlyRounded(context.digits(), [&a](const DecimalContext &g) { return g.zeta(a, g.integer(1)); }));
    if (operation == "atan2") {
        const Decimal &x = values[1];
        return text(correctlyRounded(context.digits(), [&a, &x](const DecimalContext &g) { return g.atan2(a, x); }));
    }
    //The rounding functions: exact in two more digits (ceil(9.9) is 10), then rounded to the precision
    if (operation == "floor" || operation == "ceil" || operation == "trunc") {
        const DecimalContext wide(precision + 2);
        return text(operation == "floor" ? wide.floor(a) : operation == "ceil" ? wide.ceil(a) : wide.trunc(a));
    }
    if (operation == "roundTo") return text(roundedTo(context, a, integerArgument(values[1], "The places")));
    if (operation == "fixed") return fixedText(a, integerArgument(values[1], "The places"));
    if (operation == "compare") return std::to_string(context.compare(a, values[1]));
    if (operation == "isInteger") return mpd_isinteger(a.get()) ? "true" : "false";
    throw MathError(ErrorCode::Argument, "Unknown operation of decimals: " + operation);
}

}
