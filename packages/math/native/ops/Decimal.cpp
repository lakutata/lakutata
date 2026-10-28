#include "Decimal.h"

#include <algorithm>
#include <climits>
#include <limits>
#include <cmath>
#include <functional>
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

#include "DecimalEvaluator.h"
#include "Piecewise.h"
#include "../functions/Summation.h"
#include "DecimalSupport.h"
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

DecimalContext::DecimalContext(int64_t digits)
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

void DecimalContext::check(uint32_t status)
{
    if (status & MPD_Malloc_error) throw std::bad_alloc();
    if (status & (MPD_Division_by_zero | MPD_Division_undefined)) throw MathError(ErrorCode::DivisionByZero, "Division by zero");
    if (status & (MPD_Invalid_operation | MPD_Conversion_syntax)) throw MathError(ErrorCode::Domain, "The value is not a real number");
    if (status & (MPD_Overflow | MPD_Underflow)) throw MathError(ErrorCode::NotSupported, "The value is beyond the range of the decimals (exponents from " + std::to_string(MPD_MIN_EMIN) + " to " + std::to_string(MPD_MAX_EMAX) + ")");
    if (status & (MPD_Division_impossible | MPD_Invalid_context | MPD_Fpu_error | MPD_Not_implemented)) throw MathError(ErrorCode::Internal, "An operation of the decimals failed");
}

namespace {

//A text read by mpdecimal: a decimal number, not NaN or Infinity
void requireNumber(const Decimal &value, uint32_t status, const std::string &text)
{
    if ((status & MPD_Conversion_syntax) || mpd_isspecial(value.get())) throw MathError(ErrorCode::Argument, "Not a decimal number: " + text);
    DecimalContext::check(status);
}

}

Decimal DecimalContext::parse(const std::string &text) const
{
    Decimal result;
    uint32_t status = 0;
    mpd_qset_string(result.get(), text.c_str(), &context_, &status);
    requireNumber(result, status, text);
    return result;
}

Decimal DecimalContext::exact(const std::string &text)
{
    Decimal result;
    uint32_t status = 0;
    mpd_qset_string_exact(result.get(), text.c_str(), &status);
    requireNumber(result, status, text);
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
MATH_DECIMAL_BINARY(libraryPow, mpd_qpow)
MATH_DECIMAL_UNARY(librarySqrt, mpd_qsqrt)
MATH_DECIMAL_UNARY(libraryExp, mpd_qexp)
MATH_DECIMAL_UNARY(libraryLn, mpd_qln)
MATH_DECIMAL_UNARY(neg, mpd_qminus)
MATH_DECIMAL_UNARY(abs, mpd_qabs)
MATH_DECIMAL_UNARY(floor, mpd_qfloor)
MATH_DECIMAL_UNARY(ceil, mpd_qceil)
MATH_DECIMAL_UNARY(trunc, mpd_qtrunc)
MATH_DECIMAL_UNARY(libraryLog10, mpd_qlog10)
MATH_DECIMAL_UNARY(round, mpd_qplus)
MATH_DECIMAL_UNARY(reduce, mpd_qreduce)

Decimal DecimalContext::scaleb(const Decimal &a, int64_t n) const
{
    Decimal result;
    uint32_t status = 0;
    mpd_qscaleb(result.get(), a.get(), integer(n).get(), &context_, &status);
    check(status);
    return result;
}

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

int64_t DecimalContext::exponent(const Decimal &a) const
{
    if (mpd_iszero(a.get())) return ZERO_EXPONENT;
    return static_cast<int64_t>(mpd_adjexp(a.get()));
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
    //Shared (the trigonometric functions use π at each call)
    static SharedConstant constant;
    return constant.at(*this, 10, [](const DecimalContext &guarded) {
        //Gauss and Legendre (the arithmetic-geometric mean), the digits doubled at each step: a = 1, b = 1/√2, t = 1/4,
        //then a' = (a + b)/2, b' = √(ab), t' = t - p (a - a')^2, p' = 2p, and π = (a + b)^2/(4t) (Machin's series took
        //200 ms for 10000 digits)
        const DecimalContext g(guarded.digits() + 10);
        const Decimal two = g.integer(2);
        Decimal a = g.integer(1), b = g.div(a, g.sqrt(two)), t = g.div(a, g.integer(4)), p = a;
        const Decimal limit = g.parse("1e-" + std::to_string(g.digits() / 2 + 2));
        for (;;) {
            const Decimal next = g.div(g.add(a, b), two);
            const Decimal difference = g.sub(a, next);
            b = g.sqrt(g.mul(a, b));
            t = g.sub(t, g.mul(p, g.mul(difference, difference)));
            p = g.mul(p, two);
            a = next;
            if (g.compare(g.abs(difference), limit) < 0) break;
            checkpoint();
        }
        const Decimal sum = g.add(a, b);
        return guarded.round(g.div(g.mul(sum, sum), g.mul(g.integer(4), t)));
    });
}

std::string DecimalContext::text(const Decimal &a, long digits) const
{
    uint32_t status = 0;
    mpd_context_t context = context_;
    context.prec = digits;
    Decimal rounded(a);
    mpd_qfinalize(rounded.get(), &context, &status);
    Decimal reduced;
    mpd_qreduce(reduced.get(), rounded.get(), &context, &status);
    check(status);
    if (mpd_iszero(reduced.get())) return "0";
    const int64_t first = static_cast<int64_t>(mpd_adjexp(reduced.get()));
    char *formatted = mpd_qformat(reduced.get(), first >= -6 && first < digits ? "f" : "e", &context, &status);
    check(status);
    if (!formatted) throw std::bad_alloc();
    std::string result(formatted);
    mpd_free(formatted);
    return result;
}

bool DecimalContext::nearHalf(const Decimal &a, long digits, double error) const
{
    if (isZero(a)) return false;
    const DecimalContext above(digits + 1);
    const Decimal half = above.reduce(above.round(a));
    if (static_cast<long>(half.get()->digits) != digits + 1 || mpd_lsd(half.get()->data[0]) != 5) return false;
    const int64_t distance = exponent(sub(a, half));
    return distance == ZERO_EXPONENT || static_cast<double>(distance) <= error;
}

Decimal DecimalContext::roundAtHalf(const Decimal &a, long digits, double error) const
{
    const DecimalContext target(digits);
    if (!nearHalf(a, digits, error)) return target.round(a);
    const DecimalContext above(digits + 1);
    return target.round(above.round(a));
}

Evaluator::Evaluator(const DecimalContext &context, bool last, double decidable)
    : context_(context), digits_(static_cast<double>(context.digits())), last_(last), decidable_(decidable)
{
}

std::vector<Expr> Evaluator::argumentsOf(const Basic &e)
{
    if (is_a<Pow>(e) && eq(*down_cast<const Pow &>(e).get_base(), *E)) return {down_cast<const Pow &>(e).get_exp()};
    return e.get_args();
}

Approximation Evaluator::evaluate(const Basic &e)
{
    checkpoint();
    if (is_a<Piecewise>(e)) return evaluate(*caseOf(e));
    if (dynamic_cast<const Summation *>(&e)) return evaluate(*writtenOut(e));
    std::vector<Approximation> arguments;
    for (const Expr &argument : argumentsOf(e)) arguments.push_back(evaluate(*argument));
    Approximation result = apply(e, arguments);
    result.noise = std::max(result.noise, rounding(result.value));
    return result;
}

bool Evaluator::zero(const Approximation &a) const
{
    return context_.isZero(a.value) || exponent(a.value) <= a.noise + 1;
}

bool Evaluator::last() const
{
    return last_;
}

void Evaluator::notZero(const Approximation &a, ErrorCode code, const std::string &error) const
{
    if (!zero(a)) return;
    if (!last_ || a.noise > decidable_) throw Undecided{a.noise};
    throw MathError(code, error);
}

void Evaluator::decide(double noise) const
{
    if (last_ && noise > decidable_) throw Undecided{noise};
}

double Evaluator::exponent(const Decimal &value) const
{
    const int64_t e = context_.exponent(value);
    return e == DecimalContext::ZERO_EXPONENT ? EXACT : static_cast<double>(e);
}

double Evaluator::rounding(const Decimal &value) const
{
    return context_.isZero(value) ? EXACT : exponent(value) - digits_;
}

//An approximate value, of the relative error of another one: f(x) of the relative error of x
double Evaluator::relative(const Decimal &result, const Approximation &of) const
{
    if (of.noise <= EXACT / 2) return EXACT;
    return exponent(result) + of.noise - exponent(of.value) + 1;
}

Decimal Evaluator::one() const
{
    return context_.integer(1);
}

//A function with a jump at the integers (floor) or at the halves (round): an argument within its error of a jump is at
//it
Approximation Evaluator::jump(const Approximation &x, Decimal (DecimalContext::*apply)(const Decimal &) const, bool halves) const
{
    const DecimalContext &context = context_;
    const Decimal half = context.div(one(), context.integer(2));
    const Decimal shifted = halves ? context.sub(x.value, half) : x.value;
    const Decimal nearest = context.roundToInteger(shifted);
    if (exponent(context.sub(shifted, nearest)) <= x.noise + 1) {
        decide(x.noise);
        if (!halves) return {nearest, EXACT};
        //Exactly a half: away from zero
        const Decimal at = context.add(nearest, half);
        return {context.roundToInteger(context.isNegative(at) ? context.sub(at, half) : context.add(at, half)), EXACT};
    }
    return {(context.*apply)(x.value), EXACT};
}

Approximation Evaluator::apply(const Basic &e, const std::vector<Approximation> &arguments)
{
    const DecimalContext &context = context_;
    //An integer exactly, with all its digits (sin(10^(10^4)) reduces its argument with them); a fraction of its exact
    //numerator and denominator
    if (is_a<Integer>(e)) return {DecimalContext::exact(e.__str__()), EXACT};
    if (is_a<Rational>(e)) {
        const rational_class &value = down_cast<const Rational &>(e).as_rational_class();
        return {context.div(DecimalContext::exact(SymEngine::Integer(get_num(value)).__str__()), DecimalContext::exact(SymEngine::Integer(get_den(value)).__str__())), EXACT};
    }
    if (is_a<RealDouble>(e)) {
        const Decimal value = context.parse(doubleText(down_cast<const RealDouble &>(e).i));
        return {value, exponent(value) - 16};
    }
    if (is_a<Add>(e)) {
        Decimal sum = context.integer(0);
        double noise = EXACT;
        for (const Approximation &part : arguments) {
            sum = context.add(sum, part.value);
            noise = std::max(noise, part.noise);
        }
        return {sum, noise};
    }
    if (is_a<Mul>(e)) {
        //The error of a product: the error of each factor times the others (their sizes added for each factor: the sum of
        //all less its own lost the error next to the size of a 0, -2.5e17 in doubles, and 3 - re(erf(i)) was 0)
        Decimal product = one();
        for (const Approximation &factor : arguments) product = context.mul(product, factor.value);
        double noise = EXACT;
        for (size_t i = 0; i < arguments.size(); i++) {
            if (arguments[i].noise <= EXACT / 2) continue;
            double others = 0;
            for (size_t j = 0; j < arguments.size(); j++) {
                if (j != i) others += std::max(exponent(arguments[j].value), EXACT / 4) + 1;
            }
            noise = std::max(noise, arguments[i].noise + others);
        }
        return {product, noise};
    }
    if (is_a<Pow>(e)) {
        const Pow &power = down_cast<const Pow &>(e);
        //e^x: the relative error of the result is the absolute one of x
        if (eq(*power.get_base(), *E)) {
            const Approximation &exponentPart = arguments[0];
            const Decimal value = context.exp(exponentPart.value);
            return {value, exponentPart.noise <= EXACT / 2 ? EXACT : exponent(value) + exponentPart.noise + 1};
        }
        const Approximation &base = arguments[0];
        const Approximation &exponentPart = arguments[1];
        //A base that cannot be told from 0 is 0 (sqrt(ln(6) - ln(2) - ln(3))), but in a division
        if (context.isNegative(exponentPart.value)) notZero(base, ErrorCode::DivisionByZero, "The value has no decimal value (a division by zero)");
        if (zero(base) && !context.isZero(exponentPart.value)) {
            decide(base.noise);
            return {context.integer(0), base.noise};
        }
        Decimal value;
        if (eq(*power.get_exp(), *rational(1, 2))) {
            if (context.isNegative(base.value)) notReal("the square root of a negative number");
            value = context.sqrt(base.value);
        } else {
            if (context.isNegative(base.value) && !is_a<Integer>(*power.get_exp())) notReal("a negative number to a non-integer power");
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
        const Approximation &x = arguments[0];
        notZero(x, ErrorCode::DivisionByZero, "The value has no decimal value (the logarithm of 0)");
        if (context.isNegative(x.value)) notReal("the logarithm of a negative number");
        //The absolute error of ln(x) is the relative one of x
        return {context.ln(x.value), x.noise <= EXACT / 2 ? EXACT : x.noise - exponent(x.value) + 1};
    }
    if (is_a<Abs>(e)) return {context.abs(arguments[0].value), arguments[0].noise};
    if (is_a<Floor>(e)) return jump(arguments[0], &DecimalContext::floor, false);
    if (is_a<Ceiling>(e)) return jump(arguments[0], &DecimalContext::ceil, false);
    if (is_a<Truncate>(e)) return jump(arguments[0], &DecimalContext::trunc, false);
    if (is_a<Conjugate>(e) || is_a<UnevaluatedExpr>(e)) return arguments[0];
    if (is_a<Sign>(e)) {
        const Approximation &x = arguments[0];
        if (zero(x)) decide(x.noise);
        return {context.integer(zero(x) ? 0 : context.isNegative(x.value) ? -1 : 1), EXACT};
    }
    if (is_a<Max>(e) || is_a<Min>(e)) {
        Approximation best = arguments[0];
        for (size_t i = 1; i < arguments.size(); i++) {
            if (context.compare(arguments[i].value, best.value) == (is_a<Max>(e) ? 1 : -1)) best = arguments[i];
        }
        return best;
    }
    if (is_a<ATan2>(e)) {
        const Approximation &y = arguments[0];
        const Approximation &x = arguments[1];
        if (zero(y)) decide(y.noise);
        if (zero(x)) decide(x.noise);
        //arg(x) of a real x is atan2(0, x)
        if (zero(y) && zero(x)) throw MathError(ErrorCode::Domain, "arg(0) has no value");
        const Decimal value = context.atan2(zero(y) ? context.integer(0) : y.value, zero(x) ? context.integer(0) : x.value);
        //(|x| err(y) + |y| err(x))/(x^2 + y^2)
        const double size = exponent(context.add(context.mul(x.value, x.value), context.mul(y.value, y.value)));
        double noise = EXACT;
        if (y.noise > EXACT / 2) noise = std::max(noise, std::max(exponent(x.value), EXACT / 4) + y.noise - size + 1);
        if (x.noise > EXACT / 2) noise = std::max(noise, std::max(exponent(y.value), EXACT / 4) + x.noise - size + 1);
        return {value, noise};
    }
    if (is_a<Gamma>(e) || is_a<LogGamma>(e) || is_a<PolyGamma>(e) || is_a<Beta>(e) || is_a<Erf>(e) || is_a<Erfc>(e) || is_a<Zeta>(e) ||
        is_a<LowerGamma>(e) || is_a<UpperGamma>(e) || is_a<LambertW>(e)) {
        return special(e, arguments);
    }
    if (is_a<FunctionWrapper>(e)) return wrapper(e, arguments);
    if (is_a_sub<Function>(e) && arguments.size() == 1) {
        const Approximation &x = arguments[0];
        const Decimal value = elementary(e, x.value);
        return {value, x.noise <= EXACT / 2 ? EXACT : x.noise + slope(e, x.value, value) + 1};
    }
    if (is_a<Complex>(e) || is_a<ComplexDouble>(e)) notReal(toText(e.rcp_from_this()));
    if (is_a<Infty>(e) || is_a<NaN>(e)) throw MathError(ErrorCode::Domain, toText(e.rcp_from_this()) + " has no decimal value" + (is_a<Infty>(e) && down_cast<const Infty &>(e).is_unsigned_infinity() ? " (a division by zero)" : ""));
    throw MathError(ErrorCode::NotSupported, "The decimal value of " + toText(e.rcp_from_this()) + " is not computed");
}

//An argument within its error of a pole (0 or a negative integer) is undecided, as a division by a value that cannot be
//told from 0
void Evaluator::notAtPole(const Approximation &x, const std::string &function) const
{
    if (x.noise <= EXACT / 2) return;
    const Decimal nearest = context_.roundToInteger(x.value);
    if (context_.isNegative(context_.sub(nearest, one()))) notZero({context_.sub(x.value, nearest), x.noise}, ErrorCode::DivisionByZero, "The value has no decimal value (" + function + " at a pole)");
}

//The error of a function of an inexact argument: the change of its value at the error of the argument (the other way
//when that one is outside its domain)
double Evaluator::spread(const std::function<Decimal(const std::vector<Decimal> &)> &function, std::vector<Decimal> at, size_t index, const Approximation &x,
    const Decimal &value) const
{
    const Decimal step = context_.parse("1e" + std::to_string(static_cast<long long>(std::ceil(x.noise))));
    for (int side = 0; side < 2; side++) {
        at[index] = side == 0 ? context_.add(x.value, step) : context_.sub(x.value, step);
        try {
            return exponent(context_.sub(function(at), value)) + 1;
        } catch (MathError &error) {
            if (error.code() == ErrorCode::Cancelled || error.code() == ErrorCode::Timeout) throw;
        }
    }
    if (!last_ || x.noise > decidable_) throw Undecided{x.noise};
    throw MathError(ErrorCode::Domain, "The value has no decimal value (a function at the edge of its domain within the error of its argument)");
}

//The special functions (DecimalSpecial.cpp): their poles within the errors of their arguments undecided, their errors
//the spreads of their values
Approximation Evaluator::special(const Basic &e, const std::vector<Approximation> &arguments)
{
    const DecimalContext &context = context_;
    std::vector<Decimal> values;
    for (const Approximation &argument : arguments) values.push_back(argument.value);
    const vec_basic given = e.get_args();
    long long order = 0;
    if (is_a<PolyGamma>(e)) {
        if (!is_a<Integer>(*given[0]) || down_cast<const Integer &>(*given[0]).is_negative() || context.exponent(values[0]) > 9) {
            throw MathError(ErrorCode::NotSupported, "polygamma(n, x) is computed for the integers n from 0 to 10^9");
        }
        order = smallInteger(values[0]);
    }
    if (is_a<Gamma>(e) || is_a<LogGamma>(e)) notAtPole(arguments[0], toText(e.rcp_from_this()));
    if (is_a<PolyGamma>(e)) notAtPole(arguments[1], toText(e.rcp_from_this()));
    if (is_a<Beta>(e)) {
        notAtPole(arguments[0], "beta");
        notAtPole(arguments[1], "beta");
    }
    if (is_a<LowerGamma>(e)) notAtPole(arguments[0], "lowergamma");
    if (is_a<Zeta>(e)) {
        notZero({context.sub(values[0], one()), arguments[0].noise}, ErrorCode::DivisionByZero, "The value has no decimal value (zeta at its pole)");
        notAtPole(arguments[1], "zeta");
    }
    //W at -1/e within the error of its argument: -1, of an error the square root of it (W = -1 + sqrt(2 e d)…)
    if (is_a<LambertW>(e) && arguments[0].noise > EXACT / 2) {
        const Decimal distance = context.add(values[0], context.exp(context.integer(-1)));
        if (zero({distance, arguments[0].noise})) {
            decide(arguments[0].noise);
            return {context.integer(-1), arguments[0].noise / 2 + 1};
        }
    }
    const std::function<Decimal(const std::vector<Decimal> &)> function = [&e, &context, order](const std::vector<Decimal> &at) {
        if (is_a<Gamma>(e)) return context.gamma(at[0]);
        if (is_a<LogGamma>(e)) return context.loggamma(at[0]);
        if (is_a<PolyGamma>(e)) return context.polygamma(order, at[1]);
        if (is_a<Beta>(e)) return context.beta(at[0], at[1]);
        if (is_a<Erf>(e)) return context.erf(at[0]);
        if (is_a<Erfc>(e)) return context.erfc(at[0]);
        if (is_a<Zeta>(e)) return context.zeta(at[0], at[1]);
        if (is_a<LowerGamma>(e)) return context.lowergamma(at[0], at[1]);
        if (is_a<UpperGamma>(e)) return context.uppergamma(at[0], at[1]);
        return context.lambertw(at[0]);
    };
    const Decimal value = function(values);
    double noise = EXACT;
    //An integer argument is exact: no spread
    for (size_t i = 0; i < arguments.size(); i++) {
        if (is_a<PolyGamma>(e) && i == 0) continue;
        if (is_a<Integer>(*given[i]) && context.exponent(values[i]) < static_cast<int64_t>(digits_)) continue;
        noise = std::max(noise, spread(function, values, i, arguments[i], value));
    }
    return {value, noise};
}

//The exponent of |f'(x)| for an elementary function f of value v at x: how much it scales the error of x
double Evaluator::slope(const Basic &e, const Decimal &x, const Decimal &v) const
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
Decimal Evaluator::elementary(const Basic &e, const Decimal &x) const
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
Approximation Evaluator::wrapper(const Basic &e, const std::vector<Approximation> &arguments)
{
    const DecimalContext &context = context_;
    const std::string &name = down_cast<const FunctionWrapper &>(e).get_name();
    //The real root (cbrt, root): the root of |x|, negated for a negative x and an odd degree
    if (name == "root") {
        const Approximation &x = arguments[0];
        const Decimal inverse = context.div(one(), arguments[1].value);
        if (zero(x)) {
            decide(x.noise);
            return {context.integer(0), x.noise};
        }
        const Decimal value = context.isNegative(x.value) ? context.neg(context.pow(context.abs(x.value), inverse)) : context.pow(x.value, inverse);
        return {value, relative(value, x)};
    }
    if (name == "round") return jump(arguments[0], &DecimalContext::roundToInteger, true);
    //mod(a, b) = a - b floor(a/b), a/b at a jump within its error
    if (name == "mod") {
        const Approximation &a = arguments[0];
        const Approximation &b = arguments[1];
        notZero(b, ErrorCode::Domain, "mod(a, 0) has no value");
        const Decimal quotient = context.div(a.value, b.value);
        const double noise = std::max(a.noise - exponent(b.value), exponent(quotient) + b.noise - exponent(b.value)) + 1;
        Decimal floor = context.roundToInteger(quotient);
        if (exponent(context.sub(quotient, floor)) > noise + 1) {
            floor = context.floor(quotient);
        } else {
            decide(noise);
        }
        return {context.sub(a.value, context.mul(b.value, floor)), std::max(a.noise, b.noise + exponent(floor))};
    }
    if (name == "sinc") {
        const Approximation &x = arguments[0];
        if (zero(x)) {
            decide(x.noise);
            return {one(), EXACT};
        }
        return {context.div(context.sin(x.value), x.value), x.noise};
    }
    //The parts of a real value
    if (name == "re") return arguments[0];
    if (name == "im") return {context.integer(0), EXACT};
    if (name == "arg") {
        const Approximation &x = arguments[0];
        notZero(x, ErrorCode::Domain, "arg(0) has no value");
        return {context.isNegative(x.value) ? context.pi() : context.integer(0), EXACT};
    }
    throw MathError(ErrorCode::NotSupported, "The decimal value of " + name + "() is not computed");
}

long nextGuard(long guard, double missing)
{
    const double next = std::max(static_cast<double>(guard) * 2, static_cast<double>(guard) + missing + 30);
    if (next > static_cast<double>(MORE_DIGITS)) {
        throw MathError(ErrorCode::NotSupported, "The decimal value needs more than " + std::to_string(MORE_DIGITS) + " digits beyond the ones asked (an argument too large for them)");
    }
    return static_cast<long>(std::ceil(next));
}

std::string toRealDecimal(const Expr &expression, long digits)
{
    if (digits < 1 || digits > 100000) throw MathError(ErrorCode::Argument, "The number of digits is from 1 to 100000");
    //Evaluated with more guard digits each time, until two evaluations round to the same digits; a value within its
    //error of 0, also with 640 guard digits, is 0 (a cancellation: ln(6) - ln(2) - ln(3)). From 640 guard digits on, a
    //value whose error is still above its digits (or above 10^-(digits + 600) for 0, at a jump) takes as many more as
    //its error tells, up to MORE_DIGITS, as long as they make the error smaller: an argument too large for the digits
    //(sin(10^(10^4)) needs 10^4 of them)
    const double decidable = -static_cast<double>(digits + 600);
    std::string previous;
    double previousNoise = std::numeric_limits<double>::infinity();
    bool forced = false;
    for (long guard = 10;;) {
        const DecimalContext context(static_cast<int64_t>(digits) + guard);
        const bool last = guard >= 640;
        Evaluator evaluator(context, last, forced ? std::numeric_limits<double>::infinity() : decidable);
        //More digits when they made the error smaller by a part of what they added, the decisions taken where they did not:
        //as many as the error is above the target
        auto escalate = [&](double noise, double target) {
            if (noise < previousNoise - static_cast<double>(guard) / 2) {
                previousNoise = noise;
                guard = nextGuard(guard, noise - target);
            } else {
                forced = true;
            }
        };
        Approximation value{Decimal(), EXACT};
        try {
            value = evaluator.evaluate(*expression);
        } catch (Undecided &undecided) {
            previous.clear();
            if (last) {
                escalate(undecided.noise, decidable);
            } else {
                previousNoise = undecided.noise;
                guard *= 4;
            }
            continue;
        }
        const bool zero = evaluator.zero(value);
        //An exact 0 (no rounding in it)
        if (context.isZero(value.value) && value.noise <= EXACT / 2) return "0";
        if (last) {
            const bool settled = forced || (zero ? value.noise <= decidable : value.noise <= evaluator.exponent(value.value) - static_cast<double>(digits) - 2);
            if (settled) return zero ? "0" : context.text(context.roundAtHalf(value.value, digits, value.noise + 1), digits);
            escalate(value.noise, zero ? decidable : evaluator.exponent(value.value) - static_cast<double>(digits) - 2);
            continue;
        }
        previousNoise = value.noise;
        const std::string text = zero ? "0" : context.text(value.value, digits);
        //Two agreeing roundings, not of a value within its error of a half (they would agree on either side of it)
        if (!zero && text == previous && !context.nearHalf(value.value, digits, value.noise + 1)) return text;
        previous = zero ? "" : text;
        guard *= 4;
    }
}

std::string toDecimal(const Expr &expression, long digits)
{
    try {
        return toRealDecimal(expression, digits);
    } catch (NotRealError &notReal) {
        //A value with complex parts: the real part of its complex decimals, whose imaginary part is 0 (exp(i pi)); where
        //they do not compute a node (gamma of a complex number), the part that is not real
        std::pair<std::string, std::string> parts;
        try {
            parts = toComplexDecimal(expression, digits);
        } catch (MathError &error) {
            if (error.code() == ErrorCode::NotSupported) throw notReal;
            throw;
        }
        if (parts.second != "0") throw MathError(ErrorCode::Domain, "The value is a complex number (" + toText(expression) + "): use toComplexDecimal()");
        return parts.first;
    }
}

}
