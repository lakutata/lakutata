//The special functions of the decimals: gamma and its logarithm, the polygamma functions, beta, the error functions,
//the zeta function of Hurwitz, the incomplete gamma functions and Lambert's W. Each one works with guard digits, more
//where its sums cancel, and rounds its result to the digits of its context. The asymptotic series (Stirling's, Euler and
//Maclaurin's) take their argument above a size that the digits set, by the recurrences of the functions.
#include "Decimal.h"
#include "DecimalSupport.h"

#include <algorithm>
#include <cmath>
#include <initializer_list>
#include <utility>
#include <vector>

#include "../async/Pool.h"
#include "../ntheory/NumberTheory.h"
#include "../printer/Printer.h"

namespace math {

namespace {

//The Bernoulli numbers B(2)… B(2m) of this thread, exact: computed again, for twice as many, when more are asked
const std::vector<std::pair<std::string, std::string>> &bernoulliTexts(unsigned long m)
{
    thread_local std::vector<std::pair<std::string, std::string>> texts;
    if (texts.size() < m) {
        const unsigned long count = std::max<unsigned long>(m, 2 * texts.size());
        texts.clear();
        for (const auto &[numerator, denominator] : evenBernoulli(count)) texts.emplace_back(numerator.str(), denominator.str());
    }
    return texts;
}

//B(2k), k >= 1, at the precision of a context
Decimal bernoulli(const DecimalContext &g, unsigned long k)
{
    const auto &texts = bernoulliTexts(k);
    return g.div(DecimalContext::exact(texts[k - 1].first), DecimalContext::exact(texts[k - 1].second));
}

//The terms of the asymptotic series are taken up to this many Bernoulli numbers: past them, the argument is taken larger
constexpr unsigned long MOST_TERMS = 2500;

//The size above which the asymptotic series reach the digits of g before their terms grow: about 0.6 digits (their
//smallest term is near e^(-2π z)), more for the derivatives of order n; a quarter larger each time that is not enough
double asymptoticSize(const DecimalContext &g, double more)
{
    return std::max(16.0, 0.6 * static_cast<double>(g.digits()) + more);
}

//A sum that may cancel: computed with 15 guard digits, then again with as many more as it lost (the exponent of its
//largest part above its own), until it loses no more than its guard
Decimal cancelling(const DecimalContext &context, const std::function<Decimal(const DecimalContext &, int64_t &)> &f)
{
    int64_t extra = 0;
    for (;;) {
        const DecimalContext g(context.digits() + 15 + extra);
        int64_t largest = DecimalContext::ZERO_EXPONENT;
        const Decimal value = f(g, largest);
        const int64_t lost = largest == DecimalContext::ZERO_EXPONENT ? 0 : g.isZero(value) ? g.digits() : largest - g.exponent(value);
        if (lost <= extra + 3 || extra > 4 * static_cast<int64_t>(context.digits()) + 200) return context.round(value);
        extra = lost + 5;
        checkpoint();
    }
}

int64_t largestOf(const DecimalContext &g, std::initializer_list<const Decimal *> parts)
{
    int64_t largest = DecimalContext::ZERO_EXPONENT;
    for (const Decimal *part : parts) largest = std::max(largest, g.exponent(*part));
    return largest;
}

//x shifted up by n to x + n >= size (the recurrences of the functions bring it back): n, 0 when x is already there
long long shiftTo(const DecimalContext &g, const Decimal &x, double size)
{
    if (g.compare(x, g.parse(std::to_string(static_cast<long long>(std::ceil(size))))) >= 0) return 0;
    return static_cast<long long>(std::ceil(size - toDouble(x)));
}

//ln Γ(z) by Stirling's series: false when z is too small for the digits of g (its terms grow before they are
//negligible)
bool stirling(const DecimalContext &g, const Decimal &z, Decimal &result)
{
    const Decimal one = g.integer(1);
    Decimal sum = g.add(g.sub(g.mul(g.sub(z, g.div(one, g.integer(2))), g.ln(z)), z), g.div(g.ln(g.mul(g.integer(2), g.pi())), g.integer(2)));
    const Decimal limit = g.mul(negligible(g), g.abs(sum));
    const Decimal square = g.mul(z, z);
    Decimal power = z;
    Decimal previous;
    for (unsigned long k = 1; k <= MOST_TERMS; k++) {
        const Decimal term = g.div(bernoulli(g, k), g.mul(g.integer(static_cast<long long>(2 * k * (2 * k - 1))), power));
        if (g.compare(g.abs(term), limit) < 0) {
            result = sum;
            return true;
        }
        if (k > 1 && g.compare(g.abs(term), g.abs(previous)) >= 0) return false;
        sum = g.add(sum, term);
        previous = term;
        power = g.mul(power, square);
        if (k % 16 == 0) checkpoint();
    }
    return false;
}

//ln Γ(x) of x > 0 at the precision of g, its largest part (the terms that cancel near 1 and 2) given: Stirling's series
//at x + n, less the logarithm of x (x + 1)… (x + n - 1)
Decimal logGamma(const DecimalContext &g, const Decimal &x, int64_t &largest)
{
    for (double size = asymptoticSize(g, 0);; size *= 1.25) {
        const long long shift = shiftTo(g, x, size);
        Decimal product = g.integer(1);
        for (long long k = 0; k < shift; k++) {
            product = g.mul(product, g.add(x, g.integer(k)));
            if (k % 256 == 255) checkpoint();
        }
        Decimal series;
        if (!stirling(g, g.add(x, g.integer(shift)), series)) continue;
        const Decimal logarithm = g.ln(product);
        largest = largestOf(g, {&series, &logarithm});
        return g.sub(series, logarithm);
    }
}

//The digits of ln Γ(x) above the point, about: Γ(x) = e^(ln Γ(x)) needs as many more
int64_t logGammaDigits(const DecimalContext &g, const Decimal &x)
{
    const double size = std::max(std::fabs(toDouble(x)), asymptoticSize(g, 0)) + 2;
    return static_cast<int64_t>(std::ceil(std::log10(size * std::log(size) + 1))) + 2;
}

//sin(π x) of a decimal x, of its digits: x less its nearest integer n, then (-1)^n sin(π r)
Decimal sinPi(const DecimalContext &g, const Decimal &x)
{
    const Decimal nearest = g.roundToInteger(x);
    const Decimal r = g.sub(x, nearest);
    const Decimal value = g.sin(g.mul(g.pi(), r));
    const Decimal two = g.integer(2);
    return g.isZero(g.sub(nearest, g.mul(two, g.floor(g.div(nearest, two))))) ? value : g.neg(value);
}

//cot(π x) of a decimal x: of x less its nearest integer
Decimal cotPi(const DecimalContext &g, const Decimal &x)
{
    const Decimal r = g.sub(x, g.roundToInteger(x));
    const Decimal angle = g.mul(g.pi(), r);
    return g.div(g.cos(angle), g.sin(angle));
}

//Σ j^-s, j from 1 to n, of a real s: j^-s = p^-s (j/p)^-s of the smallest prime factor p of j, so that only the primes
//have a power of their own; ln p = ln(p - 1) + 2 atanh(1/(2p - 1)), ln(p - 1) of the smaller primes, the series of
//atanh short; a half-integer s takes the square root of p instead of an exponential
Decimal riemannSum(const DecimalContext &g, const Decimal &s, long long n)
{
    std::vector<long long> smallest(static_cast<size_t>(n) + 1, 0);
    for (long long j = 2; j <= n; j++) {
        if (smallest[j]) continue;
        for (long long m = j; m <= n; m += j) {
            if (!smallest[m]) smallest[m] = j;
        }
    }
    const Decimal one = g.integer(1);
    const Decimal twice = g.mul(s, g.integer(2));
    const bool halfInteger = isInteger(twice);
    const Decimal whole = halfInteger ? g.floor(s) : Decimal();
    const Decimal limit = negligible(g);
    std::vector<Decimal> logarithms(static_cast<size_t>(n) + 1);
    std::vector<Decimal> powers(static_cast<size_t>(n) + 1);
    powers[1] = one;
    Decimal sum = one;
    for (long long j = 2; j <= n; j++) {
        const long long p = smallest[j];
        if (p == j) {
            if (halfInteger) {
                //p^-s = p^-floor(s) / sqrt(p)
                powers[j] = g.div(g.pow(g.integer(j), g.neg(whole)), g.sqrt(g.integer(j)));
            } else {
                Decimal logarithm;
                if (j == 2) {
                    logarithm = g.ln(g.integer(2));
                } else {
                    //ln(p - 1) from the primes of p - 1
                    logarithm = g.integer(0);
                    for (long long m = j - 1; m > 1; m /= smallest[m]) logarithm = g.add(logarithm, logarithms[smallest[m]]);
                    const long long q = 2 * j - 1;
                    const Decimal square = g.integer(q * q);
                    Decimal power = g.div(one, g.integer(q));
                    Decimal series = power;
                    for (long long k = 1;; k++) {
                        power = g.div(power, square);
                        const Decimal term = g.div(power, g.integer(2 * k + 1));
                        if (g.compare(term, limit) < 0) break;
                        series = g.add(series, term);
                    }
                    logarithm = g.add(logarithm, g.mul(g.integer(2), series));
                }
                logarithms[j] = logarithm;
                powers[j] = g.exp(g.neg(g.mul(s, logarithm)));
            }
        } else {
            powers[j] = g.mul(powers[p], powers[j / p]);
        }
        sum = g.add(sum, powers[j]);
        if (j % 64 == 0) checkpoint();
    }
    return sum;
}

[[noreturn]] void pole(const std::string &function)
{
    throw MathError(ErrorCode::DivisionByZero, "Division by zero (" + function + " at a pole)");
}

//ψ^(n)(z) of a large z by its asymptotic series: false when z is too small for the digits of g
bool polygammaSeries(const DecimalContext &g, long long n, const Decimal &z, Decimal &result)
{
    const Decimal one = g.integer(1);
    const Decimal square = g.mul(z, z);
    Decimal sum;
    //z^-(n + 2k), with the factor of the k-th term: (2k + n - 1)!/(2k)!
    Decimal power;
    Decimal factor = one;
    if (n == 0) {
        //ln z - 1/(2z) - Σ B(2k)/(2k z^2k)
        sum = g.sub(g.ln(z), g.div(one, g.mul(g.integer(2), z)));
        power = g.div(one, square);
    } else {
        //(-1)^(n + 1) ((n - 1)!/z^n + n!/(2 z^(n + 1)) + Σ B(2k) (2k + n - 1)!/((2k)! z^(2k + n)))
        Decimal factorial = one;
        for (long long j = 2; j < n; j++) factorial = g.mul(factorial, g.integer(j));
        const Decimal zn = g.pow(z, g.integer(n));
        sum = g.add(g.div(factorial, zn), g.div(g.mul(factorial, g.integer(n)), g.mul(g.integer(2), g.mul(zn, z))));
        power = g.div(one, g.mul(zn, square));
        for (long long j = 3; j <= n + 1; j++) factor = g.mul(factor, g.integer(j));
    }
    const Decimal limit = g.mul(negligible(g), g.abs(sum));
    Decimal previous;
    for (unsigned long k = 1; k <= MOST_TERMS; k++) {
        Decimal term = g.mul(g.mul(bernoulli(g, k), factor), power);
        if (n == 0) term = g.div(term, g.integer(static_cast<long long>(2 * k)));
        if (g.compare(g.abs(term), limit) < 0) {
            result = n == 0 ? sum : n % 2 == 1 ? sum : g.neg(sum);
            return true;
        }
        if (k > 1 && g.compare(g.abs(term), g.abs(previous)) >= 0) return false;
        sum = n == 0 ? g.sub(sum, term) : g.add(sum, term);
        previous = term;
        power = g.div(power, square);
        if (n > 0) {
            const long long a = static_cast<long long>(2 * k) + n, b = static_cast<long long>(2 * k);
            factor = g.div(g.mul(factor, g.integer(a * (a + 1))), g.integer((b + 1) * (b + 2)));
        }
        if (k % 16 == 0) checkpoint();
    }
    return false;
}

//The series of the lower incomplete gamma function: x^s e^-x Σ x^k/(s (s + 1)… (s + k)), its largest part given
Decimal lowerSeries(const DecimalContext &g, const Decimal &s, const Decimal &x, int64_t &largest)
{
    Decimal term = g.div(g.integer(1), s);
    Decimal sum = term;
    int64_t biggest = g.exponent(term);
    const Decimal limit = negligible(g);
    for (long long k = 1;; k++) {
        term = g.div(g.mul(term, x), g.add(s, g.integer(k)));
        sum = g.add(sum, term);
        biggest = std::max(biggest, g.exponent(term));
        //Past the largest terms (k above x - s), until they are negligible
        if (g.compare(g.integer(k), g.sub(g.abs(x), s)) > 0 && g.compare(g.abs(term), g.mul(limit, g.abs(sum))) < 0) break;
        if (k % 64 == 0) checkpoint();
    }
    const Decimal prefactor = g.mul(g.pow(x, s), g.exp(g.neg(x)));
    const Decimal value = g.mul(prefactor, sum);
    largest = g.exponent(prefactor) + biggest;
    return value;
}

//Γ(s, x) of a large x by its asymptotic series x^(s - 1) e^-x Σ (s - 1)(s - 2)…(s - k)/x^k: false when x is too small
bool upperAsymptotic(const DecimalContext &g, const Decimal &s, const Decimal &x, Decimal &result)
{
    Decimal term = g.integer(1);
    Decimal sum = term;
    const Decimal limit = negligible(g);
    for (long long k = 1; k <= 100000; k++) {
        const Decimal next = g.div(g.mul(term, g.sub(s, g.integer(k))), x);
        if (g.isZero(next) || g.compare(g.abs(next), limit) < 0) {
            result = g.mul(g.mul(g.pow(x, g.sub(s, g.integer(1))), g.exp(g.neg(x))), sum);
            return true;
        }
        if (g.compare(g.abs(next), g.abs(term)) >= 0) return false;
        sum = g.add(sum, next);
        term = next;
        if (k % 64 == 0) checkpoint();
    }
    return false;
}

//Whether x is large enough for the asymptotic series of Γ(s, x) and erfc: their smallest term, near e^-x, below the
//digits of g
bool largeForAsymptotic(const DecimalContext &g, const Decimal &x, const Decimal &s)
{
    const double size = (static_cast<double>(g.digits()) + 2) * 2.302585092994046 + std::fabs(toDouble(s)) + 10;
    return g.compare(x, g.parse(std::to_string(static_cast<long long>(std::ceil(size))))) > 0;
}

//A first value of W(x) in doubles, from the series at the branch point, ln(1 + x), or ln x - ln ln x, refined by
//Halley's iterations
double lambertDouble(double x)
{
    const double e = 2.718281828459045;
    double w;
    if (x < -0.32) {
        const double p = std::sqrt(std::max(0.0, 2 * (1 + e * x)));
        w = -1 + p - p * p / 3 + 11 * p * p * p / 72;
    } else if (x < 3) {
        w = std::log1p(x);
    } else {
        const double l1 = std::log(x), l2 = std::log(l1);
        w = l1 - l2 + l2 / l1;
    }
    for (int i = 0; i < 30; i++) {
        const double ew = std::exp(w), f = w * ew - x;
        const double step = f / (ew * (w + 1) - (w + 2) * f / (2 * w + 2));
        if (!std::isfinite(step)) break;
        w -= step;
        if (std::fabs(step) <= 1e-15 * std::fabs(w)) break;
    }
    return w;
}

}

Decimal DecimalContext::gamma(const Decimal &x) const
{
    if (isPole(*this, x)) pole("gamma");
    const DecimalContext g(digits() + 15);
    //Below 1/2, the reflection Γ(x) = π / (sin(π x) Γ(1 - x))
    if (compare(x, div(integer(1), integer(2))) < 0) {
        const Decimal reflected = g.sub(g.integer(1), x);
        return round(g.div(g.pi(), g.mul(sinPi(g, x), g.gamma(reflected))));
    }
    const DecimalContext h(digits() + 15 + logGammaDigits(*this, x));
    int64_t largest = 0;
    return round(h.exp(logGamma(h, x, largest)));
}

Decimal DecimalContext::loggamma(const Decimal &x) const
{
    if (isZero(x) || (isNegative(x) && isInteger(x))) pole("loggamma");
    if (isNegative(x)) notReal("loggamma of a negative number");
    //ln Γ(1) = ln Γ(2) = 0
    if (compare(x, integer(1)) == 0 || compare(x, integer(2)) == 0) return integer(0);
    return cancelling(*this, [&x](const DecimalContext &g, int64_t &largest) { return logGamma(g, x, largest); });
}

Decimal DecimalContext::polygamma(long long n, const Decimal &x) const
{
    if (n < 0) throw MathError(ErrorCode::NotSupported, "polygamma(n, x) is computed for the integers n >= 0");
    if (isPole(*this, x)) pole(n == 0 ? "digamma" : "polygamma");
    //ψ(x) below 1/2: ψ(1 - x) - π cot(π x)
    if (n == 0 && compare(x, div(integer(1), integer(2))) < 0) {
        return cancelling(*this, [&x](const DecimalContext &g, int64_t &largest) {
            const Decimal reflected = g.polygamma(0, g.sub(g.integer(1), x));
            const Decimal cotangent = g.mul(g.pi(), cotPi(g, x));
            largest = largestOf(g, {&reflected, &cotangent});
            return g.sub(reflected, cotangent);
        });
    }
    //ψ^(n)(x) = ψ^(n)(x + m) + (-1)^(n + 1) n! Σ (x + k)^-(n + 1), k < m
    return cancelling(*this, [n, &x](const DecimalContext &g, int64_t &largest) {
        for (double size = asymptoticSize(g, static_cast<double>(n));; size *= 1.25) {
            const long long shift = shiftTo(g, x, size);
            Decimal series;
            if (!polygammaSeries(g, n, g.add(x, g.integer(shift)), series)) continue;
            Decimal sum = g.integer(0);
            for (long long k = 0; k < shift; k++) {
                const Decimal base = g.add(x, g.integer(k));
                sum = g.add(sum, n == 0 ? g.div(g.integer(1), base) : g.pow(base, g.integer(-(n + 1))));
                if (k % 256 == 255) checkpoint();
            }
            Decimal factorial = g.integer(1);
            for (long long j = 2; j <= n; j++) factorial = g.mul(factorial, g.integer(j));
            //ψ(x) = ψ(x + m) - Σ 1/(x + k); ψ^(n) with the sign (-1)^(n + 1) n!
            const Decimal part = n == 0 ? g.neg(sum) : n % 2 == 1 ? g.mul(factorial, sum) : g.neg(g.mul(factorial, sum));
            largest = largestOf(g, {&series, &part});
            return g.add(series, part);
        }
    });
}

Decimal DecimalContext::beta(const Decimal &a, const Decimal &b) const
{
    if (isPole(*this, a) || isPole(*this, b)) pole("beta");
    const DecimalContext g(digits() + 15);
    //Γ(a + b) at a pole (a + b a negative integer or 0, a and b not): 0
    const DecimalContext exact(std::max<int64_t>(digits(), 1) * 2 + 20);
    const Decimal sum = exact.add(a, b);
    if (isPole(exact, sum)) return integer(0);
    return round(g.div(g.mul(g.gamma(a), g.gamma(b)), g.gamma(sum)));
}

Decimal DecimalContext::erf(const Decimal &x) const
{
    if (isZero(x)) return integer(0);
    if (isNegative(x)) return neg(erf(neg(x)));
    const DecimalContext g(digits() + 15);
    //erfc(x) below e^-x^2: past (digits + 2) ln 10, erf(x) is 1 to the digits
    const Decimal square = g.mul(x, x);
    if (g.compare(square, g.parse(std::to_string(static_cast<long long>(std::ceil((g.digits() + 2) * 2.302585092994046))))) > 0) return integer(1);
    //2/sqrt(π) e^-x^2 Σ 2^n x^(2n + 1)/(1·3…(2n + 1)): positive terms
    Decimal term = g.round(x);
    Decimal sum = term;
    const Decimal twice = g.mul(g.integer(2), square);
    const Decimal limit = negligible(g);
    for (long long n = 0;; n++) {
        term = g.div(g.mul(term, twice), g.integer(2 * n + 3));
        sum = g.add(sum, term);
        if (g.compare(g.integer(n), square) > 0 && g.compare(term, g.mul(limit, sum)) < 0) break;
        if (n % 64 == 0) checkpoint();
    }
    return round(g.div(g.mul(g.mul(g.integer(2), g.exp(g.neg(square))), sum), g.sqrt(g.pi())));
}

Decimal DecimalContext::erfc(const Decimal &x) const
{
    if (isZero(x)) return integer(1);
    //erfc(-x) = 1 + erf(x): no cancellation
    if (isNegative(x)) {
        const DecimalContext g(digits() + 15);
        return round(g.add(g.integer(1), g.erf(neg(x))));
    }
    const DecimalContext g(digits() + 15);
    if (largeForAsymptotic(g, g.mul(x, x), integer(0))) {
        //e^-x^2/(x sqrt(π)) Σ (-1)^n (2n - 1)!!/(2x^2)^n
        const Decimal twice = g.mul(g.integer(2), g.mul(x, x));
        Decimal term = g.integer(1);
        Decimal sum = term;
        const Decimal limit = negligible(g);
        for (long long n = 1;; n++) {
            const Decimal next = g.neg(g.div(g.mul(term, g.integer(2 * n - 1)), twice));
            if (g.compare(g.abs(next), limit) < 0 || g.compare(g.abs(next), g.abs(term)) >= 0) break;
            sum = g.add(sum, next);
            term = next;
            if (n % 64 == 0) checkpoint();
        }
        return round(g.div(g.mul(g.exp(g.neg(g.mul(x, x))), sum), g.mul(x, g.sqrt(g.pi()))));
    }
    //1 - erf(x), with the digits of e^-x^2 more
    const int64_t more = static_cast<int64_t>(std::ceil(toDouble(g.mul(x, x)) / 2.302585092994046)) + 5;
    const DecimalContext h(digits() + 15 + more);
    return round(h.sub(h.integer(1), h.erf(x)));
}

Decimal DecimalContext::zeta(const Decimal &s, const Decimal &a) const
{
    const Decimal one = integer(1);
    if (compare(s, one) == 0) pole("zeta");
    if (isPole(*this, a)) throw MathError(ErrorCode::DivisionByZero, "Division by zero (zeta(s, a) of a = 0 or a negative integer)");
    //Riemann's below 0: ζ(s) = 2^s π^(s - 1) sin(π s/2) Γ(1 - s) ζ(1 - s), 0 at the negative even integers
    if (compare(a, one) == 0 && isNegative(s)) {
        const DecimalContext g(digits() + 15);
        const Decimal sine = sinPi(g, g.div(s, g.integer(2)));
        if (g.isZero(sine)) return integer(0);
        const Decimal reflected = g.sub(g.integer(1), s);
        const Decimal factor = g.mul(g.pow(g.integer(2), s), g.pow(g.pi(), g.sub(s, g.integer(1))));
        return round(g.mul(g.mul(factor, sine), g.mul(g.gamma(reflected), g.zeta(reflected, g.integer(1)))));
    }
    //a below 0: ζ(s, a) = Σ (a + k)^-s + ζ(s, a + m), k < m, real for an integer s only
    if (isNegative(a)) {
        if (!isInteger(s)) notReal("zeta(s, a) of a negative a and a non-integer s");
        return cancelling(*this, [&s, &a](const DecimalContext &h, int64_t &largest) {
            const long long m = static_cast<long long>(std::ceil(-toDouble(a))) + 1;
            Decimal sum = h.integer(0);
            for (long long k = 0; k < m; k++) {
                sum = h.add(sum, h.pow(h.add(a, h.integer(k)), h.neg(s)));
                if (k % 256 == 255) checkpoint();
            }
            const Decimal rest = h.zeta(s, h.add(a, h.integer(m)));
            largest = largestOf(h, {&sum, &rest});
            return h.add(sum, rest);
        });
    }
    //A large s: Σ (a + k)^-s directly, its terms falling by (1 + 1/(a + k))^-s
    if (compare(s, integer(2 * digits() + 30)) > 0) {
        const DecimalContext g(digits() + 15);
        const Decimal limit = negligible(g);
        Decimal sum = g.integer(0);
        for (long long k = 0; k < 1000; k++) {
            const Decimal term = g.exp(g.neg(g.mul(s, g.ln(g.add(a, g.integer(k))))));
            sum = g.add(sum, term);
            if (g.compare(term, g.mul(limit, sum)) < 0) return round(sum);
        }
    }
    //Euler and Maclaurin: Σ (a + k)^-s, k < n, + w^(1 - s)/(s - 1) + w^-s/2 + Σ B(2j)/(2j)! s(s + 1)…(s + 2j - 2) w^(-s - 2j + 1),
    //w = a + n
    const bool integral = isInteger(s);
    return cancelling(*this, [&s, &a, integral](const DecimalContext &g, int64_t &largest) {
        const Decimal one = g.integer(1);
        for (double size = asymptoticSize(g, std::fabs(toDouble(s)));; size *= 1.25) {
            const long long n = shiftTo(g, a, size);
            const Decimal w = g.add(a, g.integer(n));
            const Decimal base = integral ? g.pow(w, g.neg(s)) : g.exp(g.neg(g.mul(s, g.ln(w))));
            const Decimal integral1 = g.div(g.mul(base, w), g.sub(s, one));
            Decimal tail = g.add(integral1, g.div(base, g.integer(2)));
            const Decimal limit = g.mul(negligible(g), g.abs(tail));
            //r(j) = s(s + 1)…(s + 2j - 2)/((2j)! w^(2j - 1))
            Decimal ratio = g.div(s, g.mul(g.integer(2), w));
            const Decimal square = g.mul(w, w);
            Decimal previous;
            bool converged = false;
            for (unsigned long j = 1; j <= MOST_TERMS; j++) {
                const Decimal term = g.mul(g.mul(bernoulli(g, j), ratio), base);
                if (g.isZero(term) || g.compare(g.abs(term), limit) < 0) {
                    converged = true;
                    break;
                }
                if (j > 1 && g.compare(g.abs(term), g.abs(previous)) >= 0) break;
                tail = g.add(tail, term);
                previous = term;
                const long long k = static_cast<long long>(2 * j);
                ratio = g.div(g.mul(ratio, g.mul(g.add(s, g.integer(k - 1)), g.add(s, g.integer(k)))), g.mul(g.integer((k + 1) * (k + 2)), square));
                if (j % 16 == 0) checkpoint();
            }
            if (!converged) continue;
            Decimal sum = g.integer(0);
            if (!integral && g.compare(a, one) == 0 && n <= 100000) {
                sum = riemannSum(g, s, n);
            } else {
                for (long long k = 0; k < n; k++) {
                    const Decimal at = g.add(a, g.integer(k));
                    sum = g.add(sum, integral ? g.pow(at, g.neg(s)) : g.exp(g.neg(g.mul(s, g.ln(at)))));
                    if (k % 64 == 63) checkpoint();
                }
            }
            largest = largestOf(g, {&sum, &tail});
            return g.add(sum, tail);
        }
    });
}

Decimal DecimalContext::lowergamma(const Decimal &s, const Decimal &x) const
{
    if (isPole(*this, s)) pole("lowergamma");
    if (isZero(x)) {
        if (isNegative(s)) pole("lowergamma");
        return integer(0);
    }
    if (isNegative(x) && !isInteger(s)) notReal("lowergamma(s, x) of a negative x and a non-integer s");
    return cancelling(*this, [&s, &x](const DecimalContext &g, int64_t &largest) { return lowerSeries(g, s, x, largest); });
}

Decimal DecimalContext::uppergamma(const Decimal &s, const Decimal &x) const
{
    const Decimal zero = integer(0);
    if (isZero(x)) {
        if (isPole(*this, s) || isNegative(s)) pole("uppergamma");
        return gamma(s);
    }
    const bool negativeIntegral = isPole(*this, s);
    if (isNegative(x) && (!isInteger(s) || negativeIntegral)) notReal("uppergamma(s, x) of a negative x and an s that is not a positive integer");
    //A positive integer s: (s - 1)! e^-x Σ x^k/k!, k < s
    if (isInteger(s) && !negativeIntegral && compare(s, integer(1000)) <= 0) {
        return cancelling(*this, [&s, &x](const DecimalContext &g, int64_t &largest) {
            const long long n = smallInteger(s);
            Decimal term = g.integer(1);
            Decimal sum = term;
            int64_t biggest = 0;
            for (long long k = 1; k < n; k++) {
                term = g.div(g.mul(term, x), g.integer(k));
                sum = g.add(sum, term);
                biggest = std::max(biggest, g.exponent(term));
            }
            Decimal factorial = g.integer(1);
            for (long long k = 2; k < n; k++) factorial = g.mul(factorial, g.integer(k));
            const Decimal prefactor = g.mul(factorial, g.exp(g.neg(x)));
            largest = g.exponent(prefactor) + biggest;
            return g.mul(prefactor, sum);
        });
    }
    return cancelling(*this, [&s, &x, negativeIntegral](const DecimalContext &g, int64_t &largest) {
        Decimal value;
        if (largeForAsymptotic(g, x, s) && upperAsymptotic(g, s, x, value)) {
            largest = g.exponent(value);
            return value;
        }
        if (!negativeIntegral) {
            //Γ(s) - γ(s, x)
            const Decimal whole = g.gamma(s);
            int64_t lowerLargest = 0;
            const Decimal lower = lowerSeries(g, s, x, lowerLargest);
            largest = std::max(g.exponent(whole), lowerLargest);
            return g.sub(whole, lower);
        }
        //s = -m: Γ(0, x) = E1(x) = -γ - ln x - Σ (-x)^k/(k k!), then Γ(s, x) = (Γ(s + 1, x) - x^s e^-x)/s down to s
        Decimal term = g.integer(1);
        Decimal sum = g.integer(0);
        int64_t biggest = 0;
        const Decimal limit = negligible(g);
        for (long long k = 1;; k++) {
            term = g.div(g.mul(term, g.neg(x)), g.integer(k));
            const Decimal part = g.div(term, g.integer(k));
            sum = g.add(sum, part);
            biggest = std::max(biggest, g.exponent(part));
            if (g.compare(g.integer(k), x) > 0 && g.compare(g.abs(part), limit) < 0) break;
            if (k % 64 == 0) checkpoint();
        }
        Decimal value0 = g.neg(g.add(g.add(g.eulerGamma(), g.ln(x)), sum));
        largest = std::max<int64_t>(biggest, 0);
        const long long m = -smallInteger(s);
        const Decimal decay = g.exp(g.neg(x));
        for (long long k = 1; k <= m; k++) {
            const Decimal power = g.mul(g.pow(x, g.integer(-k)), decay);
            largest = std::max(largest, std::max(g.exponent(value0), g.exponent(power)));
            value0 = g.div(g.sub(value0, power), g.integer(-k));
        }
        return value0;
    });
}

Decimal DecimalContext::lambertw(const Decimal &x) const
{
    if (isZero(x)) return integer(0);
    const DecimalContext g(digits() + 15);
    //The branch point -1/e: W(x) = -1 + p - p^2/3 + 11 p^3/72… of p = sqrt(2 (e x + 1)), its digits halved there
    const Decimal distance = g.add(x, g.exp(g.integer(-1)));
    if (g.isNegative(distance)) notReal("lambertw of a number below -1/e");
    if (g.isZero(distance)) return integer(-1);
    const DecimalContext h(digits() + 15 + smallDigits(g, distance) / 2 + 2);
    const Decimal one = h.integer(1);
    Decimal w;
    const double estimate = toDouble(x);
    if (h.exponent(distance) < -2) {
        const Decimal p = h.sqrt(h.mul(h.mul(h.integer(2), h.exp(one)), distance));
        w = h.add(h.sub(h.add(h.integer(-1), p), h.div(h.mul(p, p), h.integer(3))), h.div(h.mul(h.integer(11), h.mul(p, h.mul(p, p))), h.integer(72)));
    } else if (std::isfinite(estimate) && std::fabs(estimate) < 1e300) {
        w = h.parse(doubleText(lambertDouble(estimate)));
    } else {
        const Decimal l1 = h.ln(x);
        const Decimal l2 = h.ln(l1);
        w = h.add(h.sub(l1, l2), h.div(l2, l1));
    }
    //Halley's iterations
    for (int i = 0; i < 200; i++) {
        const Decimal ew = h.exp(w);
        const Decimal f = h.sub(h.mul(w, ew), x);
        if (h.isZero(f)) break;
        const Decimal next = h.add(w, one);
        const Decimal step = h.div(f, h.sub(h.mul(ew, next), h.div(h.mul(h.add(w, h.integer(2)), f), h.mul(h.integer(2), next))));
        w = h.sub(w, step);
        if (h.isZero(step) || h.exponent(step) < h.exponent(w) - h.digits() + 2) break;
        checkpoint();
    }
    return round(w);
}

}
