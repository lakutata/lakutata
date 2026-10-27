//The complex values of expressions in decimals: a real and an imaginary part, each with an error of its own (a small
//part next to a large one keeps its digits). A node of real arguments is the real evaluator's (Evaluator::apply) unless
//its value is not real; the others are computed here: the arithmetic, the powers, exp and ln, the trigonometric and
//hyperbolic functions and their inverses (the principal branches; on their cuts, the sides SymPy takes), abs, arg, the
//parts and the conjugate.
#include "Decimal.h"
#include "DecimalEvaluator.h"
#include "DecimalSupport.h"
#include "Piecewise.h"

#include <algorithm>
#include <cmath>
#include <limits>

#include <symengine/add.h>
#include <symengine/complex.h>
#include <symengine/complex_double.h>
#include <symengine/special_double.h>
#include <symengine/constants.h>
#include <symengine/functions.h>
#include <symengine/infinity.h>
#include <symengine/integer.h>
#include <symengine/mul.h>
#include <symengine/nan.h>
#include <symengine/pow.h>
#include <symengine/rational.h>

#include "../async/Pool.h"
#include "../printer/Printer.h"

namespace math {

using namespace SymEngine;

namespace {

//A complex decimal, without errors
struct Pair {
    Decimal re;
    Decimal im;
};

//The arithmetic of complex decimals at the precision of a context: the principal branches, a negative real number (an
//imaginary part exactly 0) on the upper side of the cuts of ln and sqrt, or on the lower one when asked
class ComplexArithmetic {
public:
    explicit ComplexArithmetic(const DecimalContext &g) : g_(g)
    {
    }

    Pair real(const Decimal &a) const
    {
        return {a, g_.integer(0)};
    }

    Pair add(const Pair &a, const Pair &b) const
    {
        return {g_.add(a.re, b.re), g_.add(a.im, b.im)};
    }

    Pair sub(const Pair &a, const Pair &b) const
    {
        return {g_.sub(a.re, b.re), g_.sub(a.im, b.im)};
    }

    Pair neg(const Pair &a) const
    {
        return {g_.neg(a.re), g_.neg(a.im)};
    }

    Pair mul(const Pair &a, const Pair &b) const
    {
        return {g_.sub(g_.mul(a.re, b.re), g_.mul(a.im, b.im)), g_.add(g_.mul(a.re, b.im), g_.mul(a.im, b.re))};
    }

    //a times i
    Pair timesI(const Pair &a) const
    {
        return {g_.neg(a.im), a.re};
    }

    Pair div(const Pair &a, const Pair &b) const
    {
        const Decimal size = g_.add(g_.mul(b.re, b.re), g_.mul(b.im, b.im));
        const Pair product = mul(a, {b.re, g_.neg(b.im)});
        return {g_.div(product.re, size), g_.div(product.im, size)};
    }

    Pair inverse(const Pair &a) const
    {
        return div(real(g_.integer(1)), a);
    }

    bool isZero(const Pair &a) const
    {
        return g_.isZero(a.re) && g_.isZero(a.im);
    }

    Decimal abs(const Pair &a) const
    {
        if (g_.isZero(a.im)) return g_.abs(a.re);
        if (g_.isZero(a.re)) return g_.abs(a.im);
        return g_.sqrt(g_.add(g_.mul(a.re, a.re), g_.mul(a.im, a.im)));
    }

    Decimal arg(const Pair &a, bool lower = false) const
    {
        if (g_.isZero(a.im)) return g_.isNegative(a.re) ? (lower ? g_.neg(g_.pi()) : g_.pi()) : g_.integer(0);
        return g_.atan2(a.im, a.re);
    }

    Pair log(const Pair &a, bool lower = false) const
    {
        if (isZero(a)) throw MathError(ErrorCode::DivisionByZero, "The value has no decimal value (the logarithm of 0)");
        return {g_.ln(abs(a)), arg(a, lower)};
    }

    Pair exp(const Pair &a) const
    {
        const Decimal size = g_.exp(a.re);
        if (g_.isZero(a.im)) return real(size);
        return {g_.mul(size, g_.cos(a.im)), g_.mul(size, g_.sin(a.im))};
    }

    //sqrt(r + a)/2 + i b/(2 sqrt((r + a)/2)) right of the imaginary axis, the other way round left of it: no cancellation
    Pair sqrt(const Pair &a, bool lower = false) const
    {
        if (isZero(a)) return a;
        const Decimal size = abs(a);
        const Decimal two = g_.integer(2);
        if (!g_.isNegative(a.re)) {
            const Decimal re = g_.sqrt(g_.div(g_.add(size, a.re), two));
            return {re, g_.div(a.im, g_.mul(two, re))};
        }
        Decimal im = g_.sqrt(g_.div(g_.sub(size, a.re), two));
        if (g_.isNegative(a.im) || (g_.isZero(a.im) && lower)) im = g_.neg(im);
        return {g_.isZero(a.im) ? g_.integer(0) : g_.div(a.im, g_.mul(two, im)), im};
    }

    Pair sin(const Pair &a) const
    {
        if (g_.isZero(a.im)) return real(g_.sin(a.re));
        return {g_.mul(g_.sin(a.re), g_.cosh(a.im)), g_.mul(g_.cos(a.re), g_.sinh(a.im))};
    }

    Pair cos(const Pair &a) const
    {
        if (g_.isZero(a.im)) return real(g_.cos(a.re));
        return {g_.mul(g_.cos(a.re), g_.cosh(a.im)), g_.neg(g_.mul(g_.sin(a.re), g_.sinh(a.im)))};
    }

    Pair sinh(const Pair &a) const
    {
        if (g_.isZero(a.im)) return real(g_.sinh(a.re));
        return {g_.mul(g_.sinh(a.re), g_.cos(a.im)), g_.mul(g_.cosh(a.re), g_.sin(a.im))};
    }

    Pair cosh(const Pair &a) const
    {
        if (g_.isZero(a.im)) return real(g_.cosh(a.re));
        return {g_.mul(g_.cosh(a.re), g_.cos(a.im)), g_.mul(g_.sinh(a.re), g_.sin(a.im))};
    }

    //asinh(w) = ln(w + sqrt(w^2 + 1)) right of the imaginary axis (and on it above 0), -asinh(-w) otherwise: the sum does
    //not cancel, and the cuts take SymPy's sides (above i from the right, below -i from the left)
    Pair asinh(const Pair &w) const
    {
        if (g_.isNegative(w.re) || (g_.isZero(w.re) && g_.isNegative(w.im))) return neg(asinh(neg(w)));
        return log(add(w, sqrt(add(mul(w, w), real(g_.integer(1))))));
    }

    //asin(z) = -i asinh(i z)
    Pair asin(const Pair &z) const
    {
        const Pair value = asinh(timesI(z));
        return {value.im, g_.neg(value.re)};
    }

    Pair acos(const Pair &z) const
    {
        return sub(real(g_.div(g_.pi(), g_.integer(2))), asin(z));
    }

    //atan(z) = i/2 (ln(1 - i z) - ln(1 + i z)): on its cuts, from the right above i, from the left below -i
    Pair atan(const Pair &z) const
    {
        const Pair one = real(g_.integer(1));
        const Pair iz = timesI(z);
        const Pair difference = sub(log(sub(one, iz)), log(add(one, iz)));
        return {g_.div(g_.neg(difference.im), g_.integer(2)), g_.div(difference.re, g_.integer(2))};
    }

    //atanh(w) = (ln(1 + w) - ln(1 - w))/2 right of the imaginary axis, -atanh(-w) left of it: on the cut right of 1,
    //from below (1 - w on the upper side of its own), left of -1 from above
    Pair atanh(const Pair &w) const
    {
        if (g_.isNegative(w.re)) return neg(atanh(neg(w)));
        const Pair one = real(g_.integer(1));
        const Pair difference = sub(log(add(one, w)), log(sub(one, w)));
        return {g_.div(difference.re, g_.integer(2)), g_.div(difference.im, g_.integer(2))};
    }

    //acosh(z) = ln(z + sqrt(z + 1) sqrt(z - 1))
    Pair acosh(const Pair &z) const
    {
        const Pair one = real(g_.integer(1));
        return log(add(z, mul(sqrt(add(z, one)), sqrt(sub(z, one)))));
    }

private:
    const DecimalContext &g_;
};

//A complex value and the errors of its parts
struct Value {
    Decimal re;
    Decimal im;
    double reNoise;
    double imNoise;
};

//A function of complex doubles: the special functions in doubles, of complex arguments
std::complex<double> specialInDoubles(const Basic &e, const std::vector<std::complex<double>> &a)
{
    if (is_a<Gamma>(e)) return special::gamma(a[0]);
    if (is_a<LogGamma>(e)) return special::loggamma(a[0]);
    if (is_a<Erf>(e)) return special::erf(a[0]);
    if (is_a<Erfc>(e)) return special::erfc(a[0]);
    if (is_a<LambertW>(e)) return special::lambertw(a[0]);
    if (is_a<Zeta>(e)) return special::zeta(a[0], a[1]);
    if (is_a<Beta>(e)) return special::beta(a[0], a[1]);
    if (is_a<LowerGamma>(e)) return special::lower_gamma(a[0], a[1]);
    if (is_a<UpperGamma>(e)) return special::upper_gamma(a[0], a[1]);
    if (is_a<PolyGamma>(e) && a[0].imag() == 0 && a[0].real() >= 0 && a[0].real() == std::floor(a[0].real()) && a[0].real() < 1e9) {
        return special::polygamma(static_cast<unsigned>(a[0].real()), a[1]);
    }
    throw NotImplementedError("Not Implemented");
}

class ComplexEvaluator {
public:
    //With doubles, the nodes the decimals do not compute (gamma of a complex number) are computed in doubles from the
    //values of their arguments, of an error of 13 digits
    ComplexEvaluator(const DecimalContext &context, bool last, bool doubles = false, double decidable = std::numeric_limits<double>::infinity())
        : context_(context), real_(context, last, decidable), last_(last), doubles_(doubles), decidable_(decidable)
    {
    }

    Value evaluate(const Basic &e)
    {
        checkpoint();
        if (is_a<Piecewise>(e)) return evaluate(*caseOf(e));
        std::vector<Value> arguments;
        for (const Expr &argument : Evaluator::argumentsOf(e)) arguments.push_back(evaluate(*argument));
        return node(e, arguments);
    }

    //A node from the values of its arguments, with the roundings of its parts
    Value node(const Basic &e, const std::vector<Value> &arguments)
    {
        Value result = doubles_ ? applyOrDoubles(e, arguments) : apply(e, arguments);
        result.reNoise = std::max(result.reNoise, real_.rounding(result.re));
        result.imNoise = std::max(result.imNoise, real_.rounding(result.im));
        return result;
    }

    //Whether a part cannot be told from 0
    bool zero(const Decimal &part, double noise) const
    {
        return real_.zero({part, noise});
    }

private:
    const DecimalContext &context_;
    Evaluator real_;
    bool last_;
    bool doubles_;
    double decidable_;

    Value applyOrDoubles(const Basic &e, const std::vector<Value> &arguments)
    {
        try {
            return apply(e, arguments);
        } catch (MathError &error) {
            if (error.code() != ErrorCode::NotSupported || !is_a_sub<Function>(e)) throw;
        }
        //The function of the doubles of its arguments (SymEngine's evaluations in doubles, special_double.h)
        std::vector<std::complex<double>> inputs;
        for (const Value &argument : arguments) {
            inputs.emplace_back(std::strtod(context_.text(argument.re, 17).c_str(), nullptr), std::strtod(context_.text(argument.im, 17).c_str(), nullptr));
        }
        std::complex<double> value;
        try {
            value = specialInDoubles(e, inputs);
        } catch (SymEngineException &) {
            throw MathError(ErrorCode::NotSupported, "The numeric value of " + toText(e.rcp_from_this()) + " is not computed");
        }
        if (!std::isfinite(value.real()) || !std::isfinite(value.imag())) throw MathError(ErrorCode::NotSupported, "The numeric value of " + toText(e.rcp_from_this()) + " is not computed");
        const Decimal re = context_.parse(doubleText(value.real())), im = context_.parse(doubleText(value.imag()));
        const double noise = std::max(exponent(re), exponent(im)) - 13;
        return {re, im, value.real() == 0 && value.imag() == 0 ? EXACT : noise, value.real() == 0 && value.imag() == 0 ? EXACT : noise};
    }

    static bool isReal(const Value &a)
    {
        return a.imNoise <= EXACT / 2 && mpd_iszero(a.im.get());
    }

    Value fromReal(const Approximation &a) const
    {
        return {a.value, context_.integer(0), a.noise, EXACT};
    }

    double exponent(const Decimal &value) const
    {
        return real_.exponent(value);
    }

    static double noiseOf(const Value &a)
    {
        return std::max(a.reNoise, a.imNoise);
    }

    //A part that cannot be told from 0, inexact: undecided before the last evaluation where the side of a cut may
    //depend on it, 0 at it
    Pair ruled(const Value &a) const
    {
        Pair pair{a.re, a.im};
        const bool reZero = !context_.isZero(a.re) && zero(a.re, a.reNoise), imZero = !context_.isZero(a.im) && zero(a.im, a.imNoise);
        if ((reZero && (!last_ || a.reNoise > decidable_)) || (imZero && (!last_ || a.imNoise > decidable_))) throw Undecided{noiseOf(a)};
        if (reZero) pair.re = context_.integer(0);
        if (imZero) pair.im = context_.integer(0);
        return pair;
    }

    //A value that must not be 0: an error at the last evaluation (a division by zero), undecided before
    void notZero(const Value &a, const std::string &error, ErrorCode code = ErrorCode::DivisionByZero) const
    {
        if (zero(a.re, a.reNoise) && zero(a.im, a.imNoise)) real_.notZero({context_.integer(0), noiseOf(a)}, code, error);
    }

    //A value of a function computed in a context of more digits, rounded to this one; the error of both its parts is
    //the error of the argument times 10^slope, |f'(z)| at most
    Value result(const Pair &value, double noise, double slope) const
    {
        const double error = noise <= EXACT / 2 ? EXACT : noise + slope + 1;
        return {context_.round(value.re), context_.round(value.im), error, error};
    }

    //The exponent of the size of a complex decimal
    double size(const ComplexArithmetic &arithmetic, const Pair &a) const
    {
        return exponent(arithmetic.abs(a));
    }

    Value add(const Value &a, const Value &b) const
    {
        return {context_.add(a.re, b.re), context_.add(a.im, b.im), std::max(a.reNoise, b.reNoise), std::max(a.imNoise, b.imNoise)};
    }

    //The error of a product of two parts: the error of each times the other
    double productNoise(const Decimal &x, double xNoise, const Decimal &y, double yNoise) const
    {
        double noise = EXACT;
        if (yNoise > EXACT / 2) noise = std::max(noise, std::max(exponent(x), EXACT / 4) + yNoise + 1);
        if (xNoise > EXACT / 2) noise = std::max(noise, std::max(exponent(y), EXACT / 4) + xNoise + 1);
        if (xNoise > EXACT / 2 && yNoise > EXACT / 2) noise = std::max(noise, xNoise + yNoise + 1);
        return noise;
    }

    Value mul(const Value &a, const Value &b) const
    {
        const ComplexArithmetic arithmetic(context_);
        const Pair product = arithmetic.mul({a.re, a.im}, {b.re, b.im});
        return {product.re, product.im,
            std::max(productNoise(a.re, a.reNoise, b.re, b.reNoise), productNoise(a.im, a.imNoise, b.im, b.imNoise)),
            std::max(productNoise(a.re, a.reNoise, b.im, b.imNoise), productNoise(a.im, a.imNoise, b.re, b.reNoise))};
    }

    //1/w: |d(1/w)| = |dw|/|w|^2
    Value inverse(const Value &w) const
    {
        notZero(w, "The value has no decimal value (a division by zero)");
        const DecimalContext g(context_.digits() + 10);
        const ComplexArithmetic arithmetic(g);
        const Pair value = arithmetic.inverse({w.re, w.im});
        return result(value, noiseOf(w), -2 * size(arithmetic, {w.re, w.im}));
    }

    //z^n of an integer n, by squarings: exact for an exact z
    Value integerPower(const Value &z, long long n)
    {
        Value base = n < 0 ? inverse(z) : z;
        unsigned long long k = n < 0 ? static_cast<unsigned long long>(-(n + 1)) + 1 : static_cast<unsigned long long>(n);
        Value product{context_.integer(1), context_.integer(0), EXACT, EXACT};
        while (k > 0) {
            if (k & 1) product = mul(product, base);
            k >>= 1;
            if (k > 0) base = mul(base, base);
            checkpoint();
        }
        return product;
    }

    Value apply(const Basic &e, const std::vector<Value> &arguments)
    {
        //Real arguments: the real node, unless its value is not real
        if (!is_a<Complex>(e) && !is_a<ComplexDouble>(e) && std::all_of(arguments.begin(), arguments.end(), isReal)) {
            std::vector<Approximation> values;
            for (const Value &argument : arguments) values.push_back({argument.re, argument.reNoise});
            try {
                return fromReal(real_.apply(e, values));
            } catch (NotRealError &) {
            }
        }
        if (is_a<Complex>(e)) {
            const Complex &number = down_cast<const Complex &>(e);
            auto part = [this](const rational_class &value) {
                return context_.div(context_.parse(SymEngine::Integer(get_num(value)).__str__()), context_.parse(SymEngine::Integer(get_den(value)).__str__()));
            };
            return {part(number.real_), part(number.imaginary_), EXACT, EXACT};
        }
        if (is_a<ComplexDouble>(e)) {
            const std::complex<double> number = down_cast<const ComplexDouble &>(e).i;
            const Decimal re = context_.parse(doubleText(number.real())), im = context_.parse(doubleText(number.imag()));
            return {re, im, exponent(re) - 16, exponent(im) - 16};
        }
        if (is_a<Add>(e)) {
            Value sum{context_.integer(0), context_.integer(0), EXACT, EXACT};
            for (const Value &term : arguments) sum = add(sum, term);
            return sum;
        }
        if (is_a<Mul>(e)) {
            Value product{context_.integer(1), context_.integer(0), EXACT, EXACT};
            for (const Value &factor : arguments) product = mul(product, factor);
            return product;
        }
        if (is_a<Pow>(e)) return power(down_cast<const Pow &>(e), arguments);
        if (is_a<Conjugate>(e)) return {arguments[0].re, context_.neg(arguments[0].im), arguments[0].reNoise, arguments[0].imNoise};
        if (is_a<UnevaluatedExpr>(e)) return arguments[0];
        if (is_a<Abs>(e)) {
            const ComplexArithmetic arithmetic(context_);
            const double noise = noiseOf(arguments[0]);
            return {arithmetic.abs({arguments[0].re, arguments[0].im}), context_.integer(0), noise <= EXACT / 2 ? EXACT : noise + 1, EXACT};
        }
        if (is_a<Sign>(e)) {
            //z/|z|: |d(z/|z|)| <= 2|dz|/|z|
            const Value &z = arguments[0];
            if (zero(z.re, z.reNoise) && zero(z.im, z.imNoise)) {
                real_.decide(noiseOf(z));
                return {context_.integer(0), context_.integer(0), EXACT, EXACT};
            }
            const DecimalContext g(context_.digits() + 10);
            const ComplexArithmetic arithmetic(g);
            const Decimal modulus = arithmetic.abs({z.re, z.im});
            return result({g.div(z.re, modulus), g.div(z.im, modulus)}, noiseOf(z), -exponent(modulus));
        }
        if (is_a<Log>(e)) return logarithm(arguments[0]);
        if (is_a<FunctionWrapper>(e)) return wrapper(down_cast<const FunctionWrapper &>(e), arguments);
        if (isElementary(e)) return elementary(e, arguments[0]);
        if (is_a<Infty>(e) || is_a<NaN>(e)) throw MathError(ErrorCode::Domain, toText(e.rcp_from_this()) + " has no decimal value" + (is_a<Infty>(e) && down_cast<const Infty &>(e).is_unsigned_infinity() ? " (a division by zero)" : ""));
        throw MathError(ErrorCode::NotSupported, "The decimal value of " + toText(e.rcp_from_this()) + " is not computed");
    }

    Value logarithm(const Value &z) const
    {
        notZero(z, "The value has no decimal value (the logarithm of 0)");
        const Pair at = ruled(z);
        const DecimalContext g(context_.digits() + 10);
        const ComplexArithmetic arithmetic(g);
        return result(arithmetic.log(at), noiseOf(z), -size(arithmetic, at));
    }

    Value exponential(const Value &z) const
    {
        const DecimalContext g(context_.digits() + 10);
        const ComplexArithmetic arithmetic(g);
        const Pair value = arithmetic.exp({z.re, z.im});
        return result(value, noiseOf(z), size(arithmetic, value));
    }

    Value squareRoot(const Value &z) const
    {
        //A root of a value that cannot be told from 0: 0, of an error the root of its error
        if (zero(z.re, z.reNoise) && zero(z.im, z.imNoise)) {
            const double noise = noiseOf(z);
            return {context_.integer(0), context_.integer(0), noise / 2 + 1, noise / 2 + 1};
        }
        const Pair at = ruled(z);
        const DecimalContext g(context_.digits() + 10);
        const ComplexArithmetic arithmetic(g);
        const Pair value = arithmetic.sqrt(at);
        return result(value, noiseOf(z), -size(arithmetic, value));
    }

    Value power(const Pow &power, const std::vector<Value> &arguments)
    {
        if (eq(*power.get_base(), *E)) return exponential(arguments[0]);
        const Value &base = arguments[0];
        const Value &exponentPart = arguments[1];
        const Expr n = power.get_exp();
        if (is_a<SymEngine::Integer>(*n) && down_cast<const SymEngine::Integer &>(*n).as_integer_class() <= 4611686018427387903LL &&
            down_cast<const SymEngine::Integer &>(*n).as_integer_class() >= -4611686018427387903LL) {
            return integerPower(base, down_cast<const SymEngine::Integer &>(*n).as_integer_class().convert_to<long long>());
        }
        if (eq(*n, *rational(1, 2))) return squareRoot(base);
        if (eq(*n, *rational(-1, 2))) return inverse(squareRoot(base));
        //0^w: 0 right of the imaginary axis, a division by zero elsewhere
        if (zero(base.re, base.reNoise) && zero(base.im, base.imNoise)) {
            if (!zero(exponentPart.re, exponentPart.reNoise) && !context_.isNegative(exponentPart.re)) {
                return {context_.integer(0), context_.integer(0), noiseOf(base), noiseOf(base)};
            }
            notZero(base, "The value has no decimal value (a division by zero)");
        }
        //exp(w ln z): |d| = |z^w| (|w| |dz|/|z| + |ln z| |dw|)
        const Pair at = ruled(base);
        const DecimalContext g(context_.digits() + 10 + static_cast<long>(std::max(0.0, exponent(context_.abs(exponentPart.re)))));
        const ComplexArithmetic arithmetic(g);
        const Pair logarithm = arithmetic.log(at);
        const Pair value = arithmetic.exp(arithmetic.mul({exponentPart.re, exponentPart.im}, logarithm));
        const double magnitude = size(arithmetic, value);
        double noise = EXACT;
        if (noiseOf(base) > EXACT / 2) noise = noiseOf(base) + magnitude + size(arithmetic, {exponentPart.re, exponentPart.im}) - size(arithmetic, at);
        if (noiseOf(exponentPart) > EXACT / 2) noise = std::max(noise, noiseOf(exponentPart) + magnitude + std::max(size(arithmetic, logarithm), 0.0));
        return result(value, noise, 0);
    }

    static bool isElementary(const Basic &e)
    {
        return is_a<Sin>(e) || is_a<Cos>(e) || is_a<Tan>(e) || is_a<Cot>(e) || is_a<Sec>(e) || is_a<Csc>(e) || is_a<Sinh>(e) || is_a<Cosh>(e) ||
            is_a<Tanh>(e) || is_a<Coth>(e) || is_a<Sech>(e) || is_a<Csch>(e) || is_a<ASin>(e) || is_a<ACos>(e) || is_a<ATan>(e) || is_a<ACot>(e) ||
            is_a<ASec>(e) || is_a<ACsc>(e) || is_a<ASinh>(e) || is_a<ACosh>(e) || is_a<ATanh>(e) || is_a<ACoth>(e) || is_a<ASech>(e) || is_a<ACsch>(e);
    }

    //The trigonometric and hyperbolic functions and their inverses of a complex value
    Value elementary(const Basic &e, const Value &z)
    {
        const double noise = noiseOf(z);
        const bool inverse = is_a<ASin>(e) || is_a<ACos>(e) || is_a<ATan>(e) || is_a<ACot>(e) || is_a<ASec>(e) || is_a<ACsc>(e) || is_a<ASinh>(e) ||
            is_a<ACosh>(e) || is_a<ATanh>(e) || is_a<ACoth>(e) || is_a<ASech>(e) || is_a<ACsch>(e);
        if (!inverse) {
            const DecimalContext g(context_.digits() + 10);
            const ComplexArithmetic arithmetic(g);
            const Pair at{z.re, z.im};
            const bool circular = is_a<Sin>(e) || is_a<Cos>(e) || is_a<Tan>(e) || is_a<Cot>(e) || is_a<Sec>(e) || is_a<Csc>(e);
            const Pair s = circular ? arithmetic.sin(at) : arithmetic.sinh(at);
            const Pair c = circular ? arithmetic.cos(at) : arithmetic.cosh(at);
            //|sin'|, |cos'| <= cosh(im z); |sinh'|, |cosh'| <= cosh(re z)
            const double bound = exponent(g.cosh(circular ? z.im : z.re));
            const double sSize = size(arithmetic, s), cSize = size(arithmetic, c);
            if (is_a<Sin>(e) || is_a<Sinh>(e)) return result(s, noise, bound);
            if (is_a<Cos>(e) || is_a<Cosh>(e)) return result(c, noise, bound);
            if (is_a<Tan>(e) || is_a<Tanh>(e)) {
                notZero({c.re, c.im, noise + bound, noise + bound}, "The value has no decimal value (a division by zero)");
                return result(arithmetic.div(s, c), noise, -2 * cSize);
            }
            if (is_a<Cot>(e) || is_a<Coth>(e)) {
                notZero({s.re, s.im, noise + bound, noise + bound}, "The value has no decimal value (a division by zero)");
                return result(arithmetic.div(c, s), noise, -2 * sSize);
            }
            if (is_a<Sec>(e) || is_a<Sech>(e)) {
                notZero({c.re, c.im, noise + bound, noise + bound}, "The value has no decimal value (a division by zero)");
                return result(arithmetic.inverse(c), noise, sSize - 2 * cSize);
            }
            notZero({s.re, s.im, noise + bound, noise + bound}, "The value has no decimal value (a division by zero)");
            return result(arithmetic.inverse(s), noise, cSize - 2 * sSize);
        }
        //The inverses of the reciprocal functions: of 1/z
        const bool reciprocal = is_a<ACot>(e) || is_a<ASec>(e) || is_a<ACsc>(e) || is_a<ACoth>(e) || is_a<ASech>(e) || is_a<ACsch>(e);
        if (is_a<ACot>(e) && zero(z.re, z.reNoise) && zero(z.im, z.imNoise)) {
            real_.decide(noise);
            return fromReal({context_.div(context_.pi(), context_.integer(2)), EXACT});
        }
        if (reciprocal) notZero(z, "The value has no decimal value (a division by zero)");
        const Pair given = ruled(z);
        //More digits for a small argument (its function cancels near 0) and near the branch points (1 - z^2 small)
        const ComplexArithmetic estimate(context_);
        const Pair at = reciprocal ? estimate.inverse(given) : given;
        const Pair square = estimate.mul(at, at);
        const Pair one = estimate.real(context_.integer(1));
        const Pair inner = is_a<ASinh>(e) || is_a<ACsch>(e) ? estimate.add(square, one) : is_a<ATan>(e) || is_a<ACot>(e) ? estimate.add(one, square) : estimate.sub(one, square);
        const int64_t more = smallDigits(context_, estimate.abs(at)) + smallDigits(context_, estimate.abs(inner));
        const DecimalContext g(context_.digits() + 10 + more);
        const ComplexArithmetic arithmetic(g);
        const Pair argument = reciprocal ? arithmetic.inverse(given) : given;
        Pair value;
        if (is_a<ASin>(e) || is_a<ACsc>(e)) value = arithmetic.asin(argument);
        else if (is_a<ACos>(e) || is_a<ASec>(e)) value = arithmetic.acos(argument);
        else if (is_a<ATan>(e) || is_a<ACot>(e)) value = arithmetic.atan(argument);
        else if (is_a<ASinh>(e) || is_a<ACsch>(e)) value = arithmetic.asinh(argument);
        else if (is_a<ACosh>(e) || is_a<ASech>(e)) value = arithmetic.acosh(argument);
        else value = arithmetic.atanh(argument);
        //|f'| of the inverse functions: 1/sqrt(1 - z^2) (asin, acos), 1/(1 + z^2) (atan), 1/sqrt(z^2 + 1) (asinh),
        //1/sqrt(z^2 - 1) (acosh), 1/(1 - z^2) (atanh); of 1/z, times 1/|z|^2
        const double innerSize = exponent(estimate.abs(inner));
        const bool logarithmic = is_a<ATan>(e) || is_a<ACot>(e) || is_a<ATanh>(e) || is_a<ACoth>(e);
        double slope = logarithmic ? -innerSize : -innerSize / 2;
        if (reciprocal) slope -= 2 * size(estimate, given);
        //Near a branch point of asin, acos, asinh, acosh (1 - z^2 or 1 + z^2 within about the error of z, 0 at it),
        //where |f'| has no bound: their values within an error d of it differ by about sqrt(2d) at most, on either side
        //of their cuts
        const double atNoise = reciprocal ? noise - 2 * size(estimate, given) : noise;
        if (!logarithmic && noise > EXACT / 2 && innerSize <= atNoise + 3) return result(value, noise, atNoise / 2 + 2 - noise);
        return result(value, noise, slope);
    }

    //The functions of the addon of a complex value: its parts, its argument, sinc
    Value wrapper(const FunctionWrapper &function, const std::vector<Value> &arguments)
    {
        const std::string &name = function.get_name();
        const Value &z = arguments[0];
        if (name == "re") return {z.re, context_.integer(0), z.reNoise, EXACT};
        if (name == "im") return {z.im, context_.integer(0), z.imNoise, EXACT};
        if (name == "arg") {
            notZero(z, "arg(0) has no value", ErrorCode::Domain);
            const Pair at = ruled(z);
            const DecimalContext g(context_.digits() + 10);
            const ComplexArithmetic arithmetic(g);
            const double noise = noiseOf(z);
            return {context_.round(arithmetic.arg(at)), context_.integer(0), noise <= EXACT / 2 ? EXACT : noise - size(arithmetic, at) + 1, EXACT};
        }
        if (name == "sinc") {
            if (zero(z.re, z.reNoise) && zero(z.im, z.imNoise)) {
                real_.decide(noiseOf(z));
                return {context_.integer(1), context_.integer(0), EXACT, EXACT};
            }
            const DecimalContext g(context_.digits() + 10);
            const ComplexArithmetic arithmetic(g);
            const Pair at{z.re, z.im};
            //|sinc'| <= cosh(im z)(1 + 1/|z|)/|z|… bounded by cosh(im z) above |z| = 1, by 1 below
            return result(arithmetic.div(arithmetic.sin(at), at), noiseOf(z), exponent(g.cosh(z.im)));
        }
        throw MathError(ErrorCode::NotSupported, "The decimal value of " + toText(function.rcp_from_this()) + " is not computed");
    }
};

//The text of a part rounded to its digits, "0" for a part that cannot be told from 0 at the last evaluation
struct PartText {
    std::string text;
    bool decided;
};

}

std::pair<std::string, std::string> toComplexDecimal(const Expr &expression, long digits)
{
    if (digits < 1 || digits > 100000) throw MathError(ErrorCode::Argument, "The number of digits is from 1 to 100000");
    //As toDecimal(), for each part: two agreeing roundings away from a half, a part that cannot be told from 0 with 640
    //guard digits is 0; more digits past them while a part's error is above its digits and they make it smaller
    const double decidable = -static_cast<double>(digits + 600);
    std::string previousRe, previousIm;
    double previousNoise = std::numeric_limits<double>::infinity();
    bool forced = false;
    for (long guard = 10;;) {
        const DecimalContext context(static_cast<int64_t>(digits) + guard);
        const bool last = guard >= 640;
        ComplexEvaluator evaluator(context, last, false, forced ? std::numeric_limits<double>::infinity() : decidable);
        auto escalate = [&](double noise, double target) {
            if (noise < previousNoise - static_cast<double>(guard) / 2) {
                previousNoise = noise;
                guard = nextGuard(guard, noise - target);
            } else {
                forced = true;
            }
        };
        Value value{Decimal(), Decimal(), EXACT, EXACT};
        try {
            value = evaluator.evaluate(*expression);
        } catch (Undecided &undecided) {
            previousRe.clear();
            previousIm.clear();
            if (last) {
                escalate(undecided.noise, decidable);
            } else {
                previousNoise = undecided.noise;
                guard *= 4;
            }
            continue;
        }
        auto exactZero = [&context](const Decimal &decimal, double noise) { return context.isZero(decimal) && noise <= EXACT / 2; };
        if (last) {
            auto settled = [&](const Decimal &decimal, double noise) {
                if (forced || exactZero(decimal, noise)) return true;
                return evaluator.zero(decimal, noise) ? noise <= decidable : noise <= static_cast<double>(context.exponent(decimal)) - static_cast<double>(digits) - 2;
            };
            if (settled(value.re, value.reNoise) && settled(value.im, value.imNoise)) {
                auto text = [&](const Decimal &decimal, double noise) {
                    return exactZero(decimal, noise) || evaluator.zero(decimal, noise) ? std::string("0") : context.text(context.roundAtHalf(decimal, digits, noise + 1), digits);
                };
                return {text(value.re, value.reNoise), text(value.im, value.imNoise)};
            }
            //The part farthest from its target
            auto missing = [&](const Decimal &decimal, double noise) {
                if (exactZero(decimal, noise)) return -std::numeric_limits<double>::infinity();
                return noise - (evaluator.zero(decimal, noise) ? decidable : static_cast<double>(context.exponent(decimal)) - static_cast<double>(digits) - 2);
            };
            const double reMissing = missing(value.re, value.reNoise), imMissing = missing(value.im, value.imNoise);
            const double noise = reMissing >= imMissing ? value.reNoise : value.imNoise;
            escalate(noise, noise - std::max(reMissing, imMissing));
            continue;
        }
        previousNoise = std::max(value.reNoise, value.imNoise);
        auto part = [&](const Decimal &decimal, double noise, const std::string &previous) -> PartText {
            if (exactZero(decimal, noise)) return {"0", true};
            if (evaluator.zero(decimal, noise)) return {"", false};
            const std::string text = context.text(decimal, digits);
            return {text, text == previous && !context.nearHalf(decimal, digits, noise + 1)};
        };
        const PartText re = part(value.re, value.reNoise, previousRe), im = part(value.im, value.imNoise, previousIm);
        if (re.decided && im.decided) return {re.text, im.text};
        previousRe = re.text;
        previousIm = im.text;
        guard *= 4;
    }
}

std::complex<double> complexDoubleValue(const Expr &expression)
{
    //One evaluation at 34 digits: the parts in doubles bring their 13 digits, the rest keeps its decimals
    const DecimalContext context(34);
    ComplexEvaluator evaluator(context, true, true);
    const Value value = evaluator.evaluate(*expression);
    auto part = [&evaluator, &context](const Decimal &decimal, double noise) {
        return evaluator.zero(decimal, noise) ? 0.0 : std::strtod(context.text(decimal, 17).c_str(), nullptr);
    };
    return {part(value.re, value.reNoise), part(value.im, value.imNoise)};
}

}
