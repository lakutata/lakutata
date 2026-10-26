//The decimals of mpdecimal: a value of a precision (significant digits), and the evaluation of an expression to one
#pragma once

#include <string>

#include "../core/Handle.h"

extern "C" {
#include <mpdecimal.h>
}

namespace math {

//A decimal of mpdecimal, owned
class Decimal {
public:
    Decimal();
    Decimal(const Decimal &other);
    Decimal(Decimal &&other) noexcept;
    Decimal &operator=(Decimal other) noexcept;
    ~Decimal();

    mpd_t *get() const;

private:
    mpd_t *value_;
};

//The arithmetic of decimals at a precision: the signals of mpdecimal turned into the errors of the addon
class DecimalContext {
public:
    //A context of a number of significant digits (the limits of the users, 1 to 100000, are checked where they give
    //them: the functions work with more, their guard digits)
    explicit DecimalContext(long digits);

    long digits() const;

    Decimal parse(const std::string &text) const;
    Decimal integer(long long value) const;
    //A decimal rounded to the digits of the context
    Decimal round(const Decimal &a) const;
    Decimal add(const Decimal &a, const Decimal &b) const;
    Decimal sub(const Decimal &a, const Decimal &b) const;
    Decimal mul(const Decimal &a, const Decimal &b) const;
    Decimal div(const Decimal &a, const Decimal &b) const;
    Decimal pow(const Decimal &a, const Decimal &b) const;
    Decimal sqrt(const Decimal &a) const;
    Decimal exp(const Decimal &a) const;
    Decimal ln(const Decimal &a) const;
    Decimal neg(const Decimal &a) const;
    Decimal abs(const Decimal &a) const;
    Decimal floor(const Decimal &a) const;
    Decimal ceil(const Decimal &a) const;
    Decimal trunc(const Decimal &a) const;
    //The nearest integer, halves away from zero
    Decimal roundToInteger(const Decimal &a) const;
    Decimal log10(const Decimal &a) const;
    int compare(const Decimal &a, const Decimal &b) const;
    bool isZero(const Decimal &a) const;
    bool isNegative(const Decimal &a) const;
    //The exponent of the first digit (0 for 1.5, -3 for 0.002), LONG_MIN for 0
    long exponent(const Decimal &a) const;

    //π at this precision
    Decimal pi() const;
    //The constants of Euler (γ) and Catalan
    Decimal eulerGamma() const;
    Decimal catalan() const;

    //The trigonometric and hyperbolic functions and their inverses (DecimalFunctions.cpp): correctly rounded to the
    //digits of the context, but for the last of them; the arguments outside the real domain throw MathError (Domain)
    Decimal sin(const Decimal &a) const;
    Decimal cos(const Decimal &a) const;
    Decimal tan(const Decimal &a) const;
    Decimal atan(const Decimal &a) const;
    Decimal asin(const Decimal &a) const;
    Decimal acos(const Decimal &a) const;
    Decimal atan2(const Decimal &y, const Decimal &x) const;
    Decimal sinh(const Decimal &a) const;
    Decimal cosh(const Decimal &a) const;
    Decimal tanh(const Decimal &a) const;
    Decimal asinh(const Decimal &a) const;
    Decimal acosh(const Decimal &a) const;
    Decimal atanh(const Decimal &a) const;

    //The text of a decimal rounded to a number of significant digits: 3.1415926536, 1.5e+25
    std::string text(const Decimal &a, long digits) const;

private:
    void check(uint32_t status) const;

    mpd_context_t context_;
};

//The value of an expression with a number of significant digits, correctly rounded: evaluated at two precisions until
//they agree (a value that stays below the roundings of its largest part, 640 digits beyond, is 0). Real values only:
//the arithmetic, powers and roots, exp and ln, the trigonometric and hyperbolic functions, the rounding functions,
//pi, e, the golden ratio, the constants of Euler and Catalan
std::string toDecimal(const Expr &expression, long digits);

}
