//The decimals of mpdecimal: a value of a precision (significant digits), and the evaluation of an expression to one
#pragma once

#include <cstdint>
#include <string>
#include <vector>

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
    explicit DecimalContext(int64_t digits);

    long digits() const;

    //A decimal of a text rounded to the digits of the context, or exactly (all its digits): the decimal numbers only
    //(not NaN, not Infinity)
    Decimal parse(const std::string &text) const;
    static Decimal exact(const std::string &text);
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
    //A decimal without its trailing zeros (1.50 is 1.5, 100 is 1E+2)
    Decimal reduce(const Decimal &a) const;
    int compare(const Decimal &a, const Decimal &b) const;
    bool isZero(const Decimal &a) const;
    bool isNegative(const Decimal &a) const;
    //The exponent of the first digit (0 for 1.5, -3 for 0.002), ZERO_EXPONENT for 0
    int64_t exponent(const Decimal &a) const;
    static constexpr int64_t ZERO_EXPONENT = INT64_MIN;

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

    //The special functions (DecimalSpecial.cpp), within a unit of the last digit of the context: a pole is a division
    //by zero (MathError DivisionByZero), an argument where the value is not real MathError (Domain)
    Decimal gamma(const Decimal &x) const;
    //ln Γ(x) of x > 0 (of a negative x it is not real)
    Decimal loggamma(const Decimal &x) const;
    //ψ^(n)(x) of an integer n >= 0: digamma for n = 0
    Decimal polygamma(long long n, const Decimal &x) const;
    Decimal beta(const Decimal &a, const Decimal &b) const;
    Decimal erf(const Decimal &x) const;
    Decimal erfc(const Decimal &x) const;
    //The zeta function of Hurwitz, ζ(s, a): Riemann's for a = 1
    Decimal zeta(const Decimal &s, const Decimal &a) const;
    //γ(s, x) and Γ(s, x): real for x >= 0, and for x < 0 with an integer s
    Decimal lowergamma(const Decimal &s, const Decimal &x) const;
    Decimal uppergamma(const Decimal &s, const Decimal &x) const;
    //The principal branch of Lambert's W, x >= -1/e
    Decimal lambertw(const Decimal &x) const;

    //The text of a decimal rounded to a number of significant digits, without trailing zeros: fixed for the exponents
    //from -6 to digits - 1 (3.1415926536, 0.000025, 100), scientific beyond (1.5e+25, 1e-7)
    std::string text(const Decimal &a, long digits) const;

    //Whether a decimal is within an error (10^error) of a half between two decimals of fewer digits: its rounding to
    //those digits is not known then
    bool nearHalf(const Decimal &a, long digits, double error) const;
    //A decimal rounded to fewer digits, halves to even, a decimal within an error of a half taken as the half: the
    //last evaluation of a value at a half exactly (log(8, 4) = 1.5 to 1 digit), which the others never tell
    Decimal roundAtHalf(const Decimal &a, long digits, double error) const;

    //The errors of the signals of mpdecimal: a division by zero, a value that is not real, an exponent beyond the
    //range of the decimals
    static void check(uint32_t status);

private:

    mpd_context_t context_;
};

//The value of an expression with a number of significant digits, correctly rounded: evaluated at two precisions until
//they agree (a value that stays below the roundings of its largest part, 640 digits beyond, is 0). Real values only:
//the arithmetic, powers and roots, exp and ln, the trigonometric and hyperbolic functions, the rounding functions,
//pi, e, the golden ratio, the constants of Euler and Catalan
std::string toDecimal(const Expr &expression, long digits);

//An operation of the decimals of a precision (the Decimal class of the package), its arguments read exactly, its result
//correctly rounded to the precision (halves to even) as a text: arithmetic, powers and roots, logarithms, the
//trigonometric and hyperbolic functions, the rounding ones, compare (-1, 0, 1), isInteger (true, false)
std::string decimalOperation(const std::string &operation, long precision, const std::vector<std::string> &arguments);

}
