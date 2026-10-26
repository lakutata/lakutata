#include "Decimal.h"

#include <algorithm>
#include <climits>
#include <vector>

#include <symengine/add.h>
#include <symengine/constants.h>
#include <symengine/functions.h>
#include <symengine/infinity.h>
#include <symengine/nan.h>
#include <symengine/integer.h>
#include <symengine/mul.h>
#include <symengine/pow.h>
#include <symengine/rational.h>
#include <symengine/complex.h>
#include <symengine/complex_double.h>
#include <symengine/real_double.h>

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
    if (digits < 1) throw MathError(ErrorCode::Argument, "The number of digits is from 1 to 100000");
    //The guard digits of an evaluation (the angle 10^(10^8) would need its digits)
    if (digits > 10000000) throw MathError(ErrorCode::NotSupported, "The decimals of the value need more than 10000000 digits");
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
MATH_DECIMAL_UNARY(floor, mpd_qfloor)
MATH_DECIMAL_UNARY(ceil, mpd_qceil)
MATH_DECIMAL_UNARY(trunc, mpd_qtrunc)
MATH_DECIMAL_UNARY(log10, mpd_qlog10)
MATH_DECIMAL_UNARY(round, mpd_qplus)

Decimal DecimalContext::integer(long long value) const
{
    Decimal result;
    uint32_t status = 0;
    mpd_qset_i64_exact(result.get(), static_cast<int64_t>(value), &status);
    check(status);
    return result;
}

Decimal DecimalContext::roundToInteger(const Decimal &a) const
{
    Decimal result;
    uint32_t status = 0;
    mpd_context_t context = context_;
    context.round = MPD_ROUND_HALF_UP;
    mpd_qround_to_int(result.get(), a.get(), &context, &status);
    check(status);
    return result;
}

long DecimalContext::exponent(const Decimal &a) const
{
    if (mpd_iszero(a.get())) return LONG_MIN;
    return static_cast<long>(mpd_adjexp(a.get()));
}

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
    //The π of the most digits computed in this thread: fewer digits are its rounding (the trigonometric functions use
    //π at each call)
    thread_local Decimal cached;
    thread_local long cachedDigits = 0;
    if (cachedDigits >= digits() + 10) return round(cached);
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
    cached = guarded.sub(guarded.mul(guarded.parse("16"), arctangentOfInverse(5)), guarded.mul(guarded.parse("4"), arctangentOfInverse(239)));
    cachedDigits = guarded.digits();
    return round(cached);
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

//A value and the decimal exponent of its absolute error (the roundings, propagated): a value within its error of 0
//is 0, an argument within its error of a jump of floor() is at the jump
struct Approximation {
    Decimal value;
    double noise;
};

//No error (an exact integer)
constexpr double EXACT = -1e18;

//A value that cannot be told from 0 where it must not be 0 (the base of a negative power, the argument of a
//logarithm): undecided below the last precision, which tries again with more digits
struct Undecided {
};

class Evaluator {
public:
    //The last evaluation (the most guard digits) decides: a value that cannot be told from 0 is 0 there
    Evaluator(const DecimalContext &context, bool last) : context_(context), digits_(static_cast<double>(context.digits())), last_(last)
    {
    }

    Approximation evaluate(const Basic &e)
    {
        checkpoint();
        Approximation result = compute(e);
        result.noise = std::max(result.noise, rounding(result.value));
        return result;
    }

    //Whether a value cannot be told from 0 at this precision
    bool zero(const Approximation &a) const
    {
        return context_.isZero(a.value) || exponent(a.value) <= a.noise + 1;
    }

private:
    const DecimalContext &context_;
    double digits_;
    bool last_;

    //A value that must not be 0 and cannot be told from it: the error of the last evaluation, undecided before
    void notZero(const Approximation &a, ErrorCode code, const std::string &error) const
    {
        if (!zero(a)) return;
        if (!last_) throw Undecided();
        throw MathError(code, error);
    }

    double exponent(const Decimal &value) const
    {
        const long e = context_.exponent(value);
        return e == LONG_MIN ? EXACT : static_cast<double>(e);
    }

    //The rounding of a value to the digits of the context
    double rounding(const Decimal &value) const
    {
        return context_.isZero(value) ? EXACT : exponent(value) - digits_;
    }

    //An approximate value, of the relative error of another one: f(x) of the relative error of x
    double relative(const Decimal &result, const Approximation &of) const
    {
        if (of.noise <= EXACT / 2) return EXACT;
        return exponent(result) + of.noise - exponent(of.value) + 1;
    }

    Decimal one() const
    {
        return context_.integer(1);
    }

    Approximation argument(const Basic &e)
    {
        return evaluate(*e.get_args()[0]);
    }

    //A function with a jump at the integers (floor) or at the halves (round): an argument within its error of a jump
    //is at it
    Approximation jump(const Basic &e, Decimal (DecimalContext::*apply)(const Decimal &) const, bool halves)
    {
        const DecimalContext &context = context_;
        const Approximation x = argument(e);
        const Decimal half = context.div(one(), context.integer(2));
        const Decimal shifted = halves ? context.sub(x.value, half) : x.value;
        const Decimal nearest = context.roundToInteger(shifted);
        if (exponent(context.sub(shifted, nearest)) <= x.noise + 1) {
            if (!halves) return {nearest, EXACT};
            //Exactly a half: away from zero
            const Decimal at = context.add(nearest, half);
            return {context.roundToInteger(context.isNegative(at) ? context.sub(at, half) : context.add(at, half)), EXACT};
        }
        return {(context.*apply)(x.value), EXACT};
    }

    Approximation compute(const Basic &e)
    {
        const DecimalContext &context = context_;
        if (is_a<Integer>(e)) {
            const Decimal value = context.parse(e.__str__());
            return {value, exponent(value) >= digits_ ? rounding(value) : EXACT};
        }
        if (is_a<Rational>(e)) {
            const rational_class &value = down_cast<const Rational &>(e).as_rational_class();
            return {context.div(context.parse(SymEngine::Integer(get_num(value)).__str__()), context.parse(SymEngine::Integer(get_den(value)).__str__())), EXACT};
        }
        if (is_a<RealDouble>(e)) {
            const Decimal value = context.parse(doubleText(down_cast<const RealDouble &>(e).i));
            return {value, exponent(value) - 16};
        }
        if (is_a<Add>(e)) {
            Decimal sum = context.integer(0);
            double noise = EXACT;
            for (const Expr &term : e.get_args()) {
                const Approximation part = evaluate(*term);
                sum = context.add(sum, part.value);
                noise = std::max(noise, part.noise);
            }
            return {sum, noise};
        }
        if (is_a<Mul>(e)) {
            //The error of a product: the error of each factor times the others
            std::vector<Approximation> factors;
            for (const Expr &factor : e.get_args()) factors.push_back(evaluate(*factor));
            Decimal product = one();
            double magnitudes = 0;
            for (const Approximation &factor : factors) {
                product = context.mul(product, factor.value);
                magnitudes += std::max(exponent(factor.value), EXACT / 4) + 1;
            }
            double noise = EXACT;
            for (const Approximation &factor : factors) {
                if (factor.noise <= EXACT / 2) continue;
                noise = std::max(noise, factor.noise + magnitudes - std::max(exponent(factor.value), EXACT / 4) - 1);
            }
            return {product, noise};
        }
        if (is_a<Pow>(e)) {
            const Pow &power = down_cast<const Pow &>(e);
            const Approximation exponentPart = evaluate(*power.get_exp());
            //e^x: the relative error of the result is the absolute one of x
            if (eq(*power.get_base(), *E)) {
                const Decimal value = context.exp(exponentPart.value);
                return {value, exponentPart.noise <= EXACT / 2 ? EXACT : exponent(value) + exponentPart.noise + 1};
            }
            const Approximation base = evaluate(*power.get_base());
            //A base that cannot be told from 0 is 0 (sqrt(ln(6) - ln(2) - ln(3))), but in a division
            if (context.isNegative(exponentPart.value)) notZero(base, ErrorCode::DivisionByZero, "The value has no decimal value (a division by zero)");
            if (zero(base) && !context.isZero(exponentPart.value)) return {context.integer(0), base.noise};
            Decimal value;
            if (eq(*power.get_exp(), *rational(1, 2))) {
                if (context.isNegative(base.value)) throw MathError(ErrorCode::Domain, "The value is not a real number (the square root of a negative number)");
                value = context.sqrt(base.value);
            } else {
                if (context.isNegative(base.value) && !is_a<Integer>(*power.get_exp())) throw MathError(ErrorCode::Domain, "The value is not a real number (a negative number to a non-integer power)");
                value = context.pow(base.value, exponentPart.value);
            }
            //b^k: the relative error of b times k, and the error of k times ln(b)
            double noise = EXACT;
            if (base.noise > EXACT / 2) noise = exponent(value) + base.noise - exponent(base.value) + std::max(0.0, exponent(exponentPart.value)) + 1;
            if (exponentPart.noise > EXACT / 2) noise = std::max(noise, exponent(value) + exponentPart.noise + 3);
            return {value, noise};
        }
        if (is_a<Constant>(e)) {
            if (eq(e, *pi)) return {context.pi(), EXACT};
            if (eq(e, *E)) return {context.exp(one()), EXACT};
            if (eq(e, *GoldenRatio)) return {context.div(context.add(one(), context.sqrt(context.integer(5))), context.integer(2)), EXACT};
            if (eq(e, *EulerGamma)) return {context.eulerGamma(), EXACT};
            if (eq(e, *Catalan)) return {context.catalan(), EXACT};
        }
        if (is_a<Log>(e)) {
            const Approximation x = argument(e);
            notZero(x, ErrorCode::DivisionByZero, "The value has no decimal value (the logarithm of 0)");
            if (context.isNegative(x.value)) throw MathError(ErrorCode::Domain, "The value is not a real number (the logarithm of a negative number)");
            //The absolute error of ln(x) is the relative one of x
            return {context.ln(x.value), x.noise <= EXACT / 2 ? EXACT : x.noise - exponent(x.value) + 1};
        }
        if (is_a<Abs>(e)) {
            const Approximation x = argument(e);
            return {context.abs(x.value), x.noise};
        }
        if (is_a<Floor>(e)) return jump(e, &DecimalContext::floor, false);
        if (is_a<Ceiling>(e)) return jump(e, &DecimalContext::ceil, false);
        if (is_a<Truncate>(e)) return jump(e, &DecimalContext::trunc, false);
        if (is_a<Conjugate>(e)) return argument(e);
        if (is_a<UnevaluatedExpr>(e)) return evaluate(*down_cast<const UnevaluatedExpr &>(e).get_arg());
        if (is_a<Sign>(e)) {
            const Approximation x = argument(e);
            return {context.integer(zero(x) ? 0 : context.isNegative(x.value) ? -1 : 1), EXACT};
        }
        if (is_a<Max>(e) || is_a<Min>(e)) {
            const vec_basic arguments = e.get_args();
            Approximation best = evaluate(*arguments[0]);
            for (size_t i = 1; i < arguments.size(); i++) {
                const Approximation next = evaluate(*arguments[i]);
                if (context.compare(next.value, best.value) == (is_a<Max>(e) ? 1 : -1)) best = next;
            }
            return best;
        }
        if (is_a<ATan2>(e)) {
            const ATan2 &angle = down_cast<const ATan2 &>(e);
            const Approximation y = evaluate(*angle.get_num());
            const Approximation x = evaluate(*angle.get_den());
            const Decimal value = context.atan2(zero(y) ? context.integer(0) : y.value, zero(x) ? context.integer(0) : x.value);
            //(|x| err(y) + |y| err(x))/(x^2 + y^2)
            const double size = exponent(context.add(context.mul(x.value, x.value), context.mul(y.value, y.value)));
            double noise = EXACT;
            if (y.noise > EXACT / 2) noise = std::max(noise, std::max(exponent(x.value), EXACT / 4) + y.noise - size + 1);
            if (x.noise > EXACT / 2) noise = std::max(noise, std::max(exponent(y.value), EXACT / 4) + x.noise - size + 1);
            return {value, noise};
        }
        if (is_a<FunctionWrapper>(e)) return wrapper(down_cast<const FunctionWrapper &>(e));
        if (is_a_sub<Function>(e) && e.get_args().size() == 1) {
            const Approximation x = argument(e);
            const Decimal value = elementary(e, x.value);
            return {value, x.noise <= EXACT / 2 ? EXACT : x.noise + slope(e, x.value, value) + 1};
        }
        if (is_a<Complex>(e) || is_a<ComplexDouble>(e)) throw MathError(ErrorCode::Domain, "The value is not a real number (" + toText(e.rcp_from_this()) + ")");
        if (is_a<Infty>(e) || is_a<NaN>(e)) throw MathError(ErrorCode::Domain, toText(e.rcp_from_this()) + " has no decimal value" + (is_a<Infty>(e) && down_cast<const Infty &>(e).is_unsigned_infinity() ? " (a division by zero)" : ""));
        throw MathError(ErrorCode::NotSupported, "The decimal value of " + toText(e.rcp_from_this()) + " is not computed");
    }

    //The exponent of |f'(x)| for an elementary function f of value v at x: how much it scales the error of x
    double slope(const Basic &e, const Decimal &x, const Decimal &v) const
    {
        const DecimalContext &context = context_;
        const Decimal square = context.mul(x, x);
        const Decimal valueSquare = context.mul(v, v);
        auto of = [this](const Decimal &a) { return context_.isZero(a) ? 0.0 : exponent(context_.abs(a)); };
        if (is_a<Sin>(e) || is_a<Cos>(e)) return 0;
        //tan' = 1 + tan^2, cot' = -(1 + cot^2), sec' = sec tan, csc' = -csc cot
        if (is_a<Tan>(e) || is_a<Cot>(e)) return of(context.add(one(), valueSquare));
        if (is_a<Sec>(e) || is_a<Csc>(e)) return 2 * std::max(0.0, of(v)) + 1;
        //asin' = 1/sqrt(1 - x^2), atan' = 1/(1 + x^2)
        if (is_a<ASin>(e) || is_a<ACos>(e)) return -of(context.sub(one(), square)) / 2;
        if (is_a<ATan>(e) || is_a<ACot>(e)) return -of(context.add(one(), square));
        //asec(x)' = 1/(|x| sqrt(x^2 - 1))
        if (is_a<ASec>(e) || is_a<ACsc>(e)) return -of(x) - of(context.sub(square, one())) / 2;
        if (is_a<Sinh>(e) || is_a<Cosh>(e) || is_a<Sech>(e)) return std::max(0.0, of(v));
        if (is_a<Csch>(e)) return 2 * std::max(0.0, -of(x)) + 1;
        //tanh' = 1 - tanh^2, coth' = 1 - coth^2
        if (is_a<Tanh>(e) || is_a<Coth>(e)) return of(context.sub(one(), valueSquare));
        if (is_a<ASinh>(e)) return -of(context.add(square, one())) / 2;
        if (is_a<ACosh>(e)) return -of(context.sub(square, one())) / 2;
        if (is_a<ATanh>(e) || is_a<ACoth>(e)) return -of(context.sub(one(), square));
        if (is_a<ASech>(e)) return -of(x) - of(context.sub(one(), square)) / 2;
        if (is_a<ACsch>(e)) return -of(x) - of(context.add(one(), square)) / 2;
        return std::max(0.0, of(v) - of(x));
    }

    //The trigonometric and hyperbolic functions and their inverses of a value
    Decimal elementary(const Basic &e, const Decimal &x) const
    {
        const DecimalContext &context = context_;
        if (is_a<Sin>(e)) return context.sin(x);
        if (is_a<Cos>(e)) return context.cos(x);
        if (is_a<Tan>(e)) return context.tan(x);
        if (is_a<Cot>(e)) return context.div(one(), context.tan(x));
        if (is_a<Sec>(e)) return context.div(one(), context.cos(x));
        if (is_a<Csc>(e)) return context.div(one(), context.sin(x));
        if (is_a<ASin>(e)) return context.asin(x);
        if (is_a<ACos>(e)) return context.acos(x);
        if (is_a<ATan>(e)) return context.atan(x);
        //acot(x) is atan(1/x), pi/2 at 0
        if (is_a<ACot>(e)) return context.isZero(x) ? context.div(context.pi(), context.integer(2)) : context.atan(context.div(one(), x));
        if (is_a<ASec>(e)) return context.acos(context.div(one(), x));
        if (is_a<ACsc>(e)) return context.asin(context.div(one(), x));
        if (is_a<Sinh>(e)) return context.sinh(x);
        if (is_a<Cosh>(e)) return context.cosh(x);
        if (is_a<Tanh>(e)) return context.tanh(x);
        if (is_a<Coth>(e)) return context.div(one(), context.tanh(x));
        if (is_a<Sech>(e)) return context.div(one(), context.cosh(x));
        if (is_a<Csch>(e)) return context.div(one(), context.sinh(x));
        if (is_a<ASinh>(e)) return context.asinh(x);
        if (is_a<ACosh>(e)) return context.acosh(x);
        if (is_a<ATanh>(e)) return context.atanh(x);
        if (is_a<ACoth>(e)) return context.atanh(context.div(one(), x));
        if (is_a<ASech>(e)) return context.acosh(context.div(one(), x));
        if (is_a<ACsch>(e)) return context.asinh(context.div(one(), x));
        throw MathError(ErrorCode::NotSupported, "The decimal value of " + toText(e.rcp_from_this()) + " is not computed");
    }

    //The functions of the addon (functions/Functions.h)
    Approximation wrapper(const FunctionWrapper &function)
    {
        const DecimalContext &context = context_;
        const std::string &name = function.get_name();
        const vec_basic arguments = function.get_args();
        //The real root (cbrt, root): the root of |x|, negated for a negative x and an odd degree
        if (name == "root") {
            const Approximation x = evaluate(*arguments[0]);
            const Decimal inverse = context.div(one(), evaluate(*arguments[1]).value);
            if (zero(x)) return {context.integer(0), x.noise};
            const Decimal value = context.isNegative(x.value) ? context.neg(context.pow(context.abs(x.value), inverse)) : context.pow(x.value, inverse);
            return {value, relative(value, x)};
        }
        if (name == "round") return jump(function, &DecimalContext::roundToInteger, true);
        //mod(a, b) = a - b floor(a/b), a/b at a jump within its error
        if (name == "mod") {
            const Approximation a = evaluate(*arguments[0]);
            const Approximation b = evaluate(*arguments[1]);
            notZero(b, ErrorCode::Domain, "mod(a, 0) has no value");
            const Decimal quotient = context.div(a.value, b.value);
            const double noise = std::max(a.noise - exponent(b.value), exponent(quotient) + b.noise - exponent(b.value)) + 1;
            Decimal floor = context.roundToInteger(quotient);
            if (exponent(context.sub(quotient, floor)) > noise + 1) floor = context.floor(quotient);
            return {context.sub(a.value, context.mul(b.value, floor)), std::max(a.noise, b.noise + exponent(floor))};
        }
        if (name == "sinc") {
            const Approximation x = evaluate(*arguments[0]);
            if (zero(x)) return {one(), EXACT};
            return {context.div(context.sin(x.value), x.value), x.noise};
        }
        //The parts of a real value
        if (name == "re") return evaluate(*arguments[0]);
        if (name == "im") {
            evaluate(*arguments[0]);
            return {context.integer(0), EXACT};
        }
        if (name == "arg") {
            const Approximation x = evaluate(*arguments[0]);
            notZero(x, ErrorCode::Domain, "arg(0) has no value");
            return {context.isNegative(x.value) ? context.pi() : context.integer(0), EXACT};
        }
        throw MathError(ErrorCode::NotSupported, "The decimal value of " + name + "() is not computed");
    }
};

}

std::string toDecimal(const Expr &expression, long digits)
{
    if (digits < 1 || digits > 100000) throw MathError(ErrorCode::Argument, "The number of digits is from 1 to 100000");
    //Evaluated with more guard digits each time, until two evaluations round to the same digits; a value within its
    //error of 0, also with 640 guard digits, is 0 (a cancellation: ln(6) - ln(2) - ln(3))
    std::string previous;
    for (long guard = 10;; guard *= 4) {
        const DecimalContext context(digits + guard);
        Evaluator evaluator(context, guard >= 640);
        Approximation value{Decimal(), EXACT};
        try {
            value = evaluator.evaluate(*expression);
        } catch (Undecided &) {
            previous.clear();
            continue;
        }
        const bool zero = evaluator.zero(value);
        const std::string text = zero ? "0" : context.text(value.value, digits);
        //An exact 0 (no rounding in it)
        if (context.isZero(value.value) && value.noise <= EXACT / 2) return "0";
        if (guard >= 640 || (!zero && text == previous)) return text;
        previous = zero ? "" : text;
    }
}

}
