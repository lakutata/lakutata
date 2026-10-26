#include "Decimal.h"

#include <symengine/add.h>
#include <symengine/constants.h>
#include <symengine/functions.h>
#include <symengine/infinity.h>
#include <symengine/nan.h>
#include <symengine/integer.h>
#include <symengine/mul.h>
#include <symengine/pow.h>
#include <symengine/rational.h>

#include "../async/Pool.h"
#include "../printer/Printer.h"

namespace math {

using namespace SymEngine;

Decimal::Decimal() : value_(mpd_qnew())
{
    if (!value_) throw std::bad_alloc();
}

Decimal::Decimal(const Decimal &other) : Decimal()
{
    uint32_t status = 0;
    mpd_qcopy(value_, other.value_, &status);
    if (status & MPD_Malloc_error) throw std::bad_alloc();
}

Decimal::Decimal(Decimal &&other) noexcept : value_(other.value_)
{
    other.value_ = nullptr;
}

Decimal &Decimal::operator=(Decimal other) noexcept
{
    std::swap(value_, other.value_);
    return *this;
}

Decimal::~Decimal()
{
    if (value_) mpd_del(value_);
}

mpd_t *Decimal::get() const
{
    return value_;
}

DecimalContext::DecimalContext(long digits)
{
    if (digits < 1 || digits > 100000) throw MathError(ErrorCode::Argument, "The number of digits is from 1 to 100000");
    mpd_maxcontext(&context_);
    context_.prec = digits;
    context_.round = MPD_ROUND_HALF_EVEN;
}

long DecimalContext::digits() const
{
    return static_cast<long>(context_.prec);
}

void DecimalContext::check(uint32_t status) const
{
    if (status & MPD_Malloc_error) throw std::bad_alloc();
    if (status & MPD_Division_by_zero) throw MathError(ErrorCode::DivisionByZero, "Division by zero");
    if (status & (MPD_Invalid_operation | MPD_Conversion_syntax)) throw MathError(ErrorCode::Domain, "The value is not a real number");
}

Decimal DecimalContext::parse(const std::string &text) const
{
    Decimal result;
    uint32_t status = 0;
    mpd_qset_string(result.get(), text.c_str(), &context_, &status);
    check(status);
    return result;
}

#define MATH_DECIMAL_BINARY(name, function) \
    Decimal DecimalContext::name(const Decimal &a, const Decimal &b) const \
    { \
        Decimal result; \
        uint32_t status = 0; \
        function(result.get(), a.get(), b.get(), &context_, &status); \
        check(status); \
        return result; \
    }

#define MATH_DECIMAL_UNARY(name, function) \
    Decimal DecimalContext::name(const Decimal &a) const \
    { \
        Decimal result; \
        uint32_t status = 0; \
        function(result.get(), a.get(), &context_, &status); \
        check(status); \
        return result; \
    }

MATH_DECIMAL_BINARY(add, mpd_qadd)
MATH_DECIMAL_BINARY(sub, mpd_qsub)
MATH_DECIMAL_BINARY(mul, mpd_qmul)
MATH_DECIMAL_BINARY(div, mpd_qdiv)
MATH_DECIMAL_BINARY(pow, mpd_qpow)
MATH_DECIMAL_UNARY(sqrt, mpd_qsqrt)
MATH_DECIMAL_UNARY(exp, mpd_qexp)
MATH_DECIMAL_UNARY(ln, mpd_qln)
MATH_DECIMAL_UNARY(neg, mpd_qminus)
MATH_DECIMAL_UNARY(abs, mpd_qabs)

int DecimalContext::compare(const Decimal &a, const Decimal &b) const
{
    uint32_t status = 0;
    const int result = mpd_qcmp(a.get(), b.get(), &status);
    check(status);
    return result;
}

bool DecimalContext::isZero(const Decimal &a) const
{
    return mpd_iszero(a.get());
}

bool DecimalContext::isNegative(const Decimal &a) const
{
    return mpd_isnegative(a.get()) && !mpd_iszero(a.get());
}

Decimal DecimalContext::pi() const
{
    //Machin: π = 16 atan(1/5) - 4 atan(1/239), atan(1/x) = Σ (-1)^k / ((2k + 1) x^(2k + 1)), with guard digits
    DecimalContext guarded(digits() + 10);
    auto arctangentOfInverse = [&guarded](long x) {
        const Decimal square = guarded.parse(std::to_string(x * x));
        Decimal power = guarded.div(guarded.parse("1"), guarded.parse(std::to_string(x)));
        Decimal sum = power;
        const Decimal limit = guarded.pow(guarded.parse("10"), guarded.parse(std::to_string(-guarded.digits() - 2)));
        for (long k = 1;; k++) {
            if (k % 64 == 0) checkpoint();
            power = guarded.div(power, square);
            const Decimal term = guarded.div(power, guarded.parse(std::to_string(2 * k + 1)));
            if (guarded.compare(term, limit) < 0) break;
            sum = k % 2 ? guarded.sub(sum, term) : guarded.add(sum, term);
        }
        return sum;
    };
    return guarded.sub(guarded.mul(guarded.parse("16"), arctangentOfInverse(5)), guarded.mul(guarded.parse("4"), arctangentOfInverse(239)));
}

std::string DecimalContext::text(const Decimal &a, long digits) const
{
    uint32_t status = 0;
    Decimal rounded(a);
    mpd_context_t context = context_;
    context.prec = digits;
    mpd_qfinalize(rounded.get(), &context, &status);
    check(status);
    char *formatted = mpd_qformat(rounded.get(), ("." + std::to_string(digits) + "g").c_str(), &context, &status);
    check(status);
    if (!formatted) throw std::bad_alloc();
    std::string result(formatted);
    mpd_free(formatted);
    return result;
}

namespace {

Decimal evaluate(const Basic &e, const DecimalContext &context)
{
    checkpoint();
    if (is_a<Integer>(e)) return context.parse(e.__str__());
    if (is_a<Rational>(e)) {
        const rational_class &value = down_cast<const Rational &>(e).as_rational_class();
        return context.div(context.parse(SymEngine::Integer(get_num(value)).__str__()), context.parse(SymEngine::Integer(get_den(value)).__str__()));
    }
    if (is_a<Add>(e)) {
        Decimal sum = context.parse("0");
        for (const Expr &term : e.get_args()) sum = context.add(sum, evaluate(*term, context));
        return sum;
    }
    if (is_a<Mul>(e)) {
        Decimal product = context.parse("1");
        for (const Expr &factor : e.get_args()) product = context.mul(product, evaluate(*factor, context));
        return product;
    }
    if (is_a<Pow>(e)) {
        const Pow &power = down_cast<const Pow &>(e);
        const Decimal exponent = evaluate(*power.get_exp(), context);
        if (eq(*power.get_base(), *E)) return context.exp(exponent);
        const Decimal base = evaluate(*power.get_base(), context);
        if (eq(*power.get_exp(), *rational(1, 2))) {
            if (context.isNegative(base)) throw MathError(ErrorCode::Domain, "The value is not a real number (the square root of a negative number)");
            return context.sqrt(base);
        }
        if (context.isNegative(base) && !is_a<Integer>(*power.get_exp())) throw MathError(ErrorCode::Domain, "The value is not a real number (a negative number to a non-integer power)");
        return context.pow(base, exponent);
    }
    if (is_a<Constant>(e)) {
        if (eq(e, *pi)) return context.pi();
        if (eq(e, *E)) return context.exp(context.parse("1"));
    }
    if (is_a<Log>(e)) {
        const Decimal argument = evaluate(*down_cast<const Log &>(e).get_arg(), context);
        if (!context.isNegative(argument) && !context.isZero(argument)) return context.ln(argument);
        throw MathError(ErrorCode::Domain, "The value is not a real number (the logarithm of a number not positive)");
    }
    if (is_a<Abs>(e)) return context.abs(evaluate(*down_cast<const Abs &>(e).get_arg(), context));
    if (is_a<Infty>(e) || is_a<NaN>(e)) throw MathError(ErrorCode::Domain, toText(e.rcp_from_this()) + " has no decimal value" + (is_a<Infty>(e) && down_cast<const Infty &>(e).is_unsigned_infinity() ? " (a division by zero)" : ""));
    throw MathError(ErrorCode::NotSupported, "The decimal value of " + toText(e.rcp_from_this()) + " is not computed");
}

}

std::string toDecimal(const Expr &expression, long digits)
{
    //Guard digits: the operations round at each step
    const DecimalContext context(digits + 10);
    return context.text(evaluate(*expression, context), digits);
}

}
