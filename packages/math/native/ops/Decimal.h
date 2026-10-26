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
    explicit DecimalContext(long digits);

    long digits() const;

    Decimal parse(const std::string &text) const;
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
    int compare(const Decimal &a, const Decimal &b) const;
    bool isZero(const Decimal &a) const;
    bool isNegative(const Decimal &a) const;

    //π at this precision
    Decimal pi() const;

    //The text of a decimal rounded to a number of significant digits: 3.1415926536, 1.5e+25
    std::string text(const Decimal &a, long digits) const;

private:
    void check(uint32_t status) const;

    mpd_context_t context_;
};

//The value of an expression with a number of significant digits (real; π, e, the arithmetic, powers and roots, exp
//and ln)
std::string toDecimal(const Expr &expression, long digits);

}
