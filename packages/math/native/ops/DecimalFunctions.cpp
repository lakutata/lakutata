//The functions of the decimals mpdecimal has not: the trigonometric and hyperbolic ones and their inverses, the
//constants of Euler and Catalan. Each one works with guard digits (more for the digits a reduction loses) and rounds
//its result to the digits of its context.
#include "Decimal.h"
#include "DecimalSupport.h"

#include <algorithm>
#include <climits>
#include <cmath>
#include <string>

#include "../async/Pool.h"
#include "../core/Errors.h"
#include "../printer/Printer.h"

namespace math {

namespace {

//Whether e^-|a| is below the last guard digit of a context: e^|a| ± e^-|a| is e^|a| there (and e^-|a| may be beyond
//the exponents of the decimals)
bool negligibleInverse(const DecimalContext &g, const Decimal &a)
{
    return g.compare(g.abs(a), g.integer(g.digits() * 3 + 10)) > 0;
}

//The Taylor series of sin (odd) or cos (even) at r, |r| <= pi/4: of 1 - cos(r/2^k) above FAST_DIGITS, doubled back k
//times by 1 - cos 2t = 2 (1 - cos t)(1 + cos t), its terms fewer by far (sin(1) to 10000 digits had 2500)
Decimal sinCosSeries(const DecimalContext &g, const Decimal &r, bool cosine)
{
    if (g.digits() > DecimalContext::FAST_DIGITS && !g.isZero(r)) {
        const long halvings = static_cast<long>(std::ceil(std::sqrt(static_cast<double>(g.digits()) * 0.6)));
        const DecimalContext h(g.digits() + static_cast<long>(std::log10(static_cast<double>(halvings))) + 4);
        const Decimal t = h.div(r, h.pow(h.integer(2), h.integer(halvings)));
        const Decimal square = h.mul(t, t);
        const Decimal limit = h.mul(negligible(h), square);
        //1 - cos t = t^2/2 - t^4/24 + …
        Decimal term = h.div(square, h.integer(2));
        Decimal y = term;
        for (long long power = 2;; power += 2) {
            term = h.neg(h.div(h.mul(term, square), h.integer((power + 1) * (power + 2))));
            if (h.compare(h.abs(term), limit) < 0) break;
            y = h.add(y, term);
            if (power % 128 == 0) checkpoint();
        }
        const Decimal two = h.integer(2);
        for (long i = 0; i < halvings; i++) y = h.mul(h.mul(two, y), h.sub(two, y));
        if (cosine) return g.round(h.sub(h.integer(1), y));
        const Decimal sine = h.sqrt(h.mul(y, h.sub(two, y)));
        return g.round(h.isNegative(r) ? h.neg(sine) : sine);
    }
    const Decimal square = g.mul(r, r);
    const Decimal limit = negligible(g);
    Decimal term = cosine ? g.integer(1) : r;
    Decimal sum = term;
    for (long long power = cosine ? 0 : 1;; power += 2) {
        term = g.neg(g.div(g.mul(term, square), g.integer((power + 1) * (power + 2))));
        if (g.compare(g.abs(term), limit) < 0) break;
        sum = g.add(sum, term);
        if (power % 128 == 1 || power % 128 == 0) checkpoint();
    }
    return sum;
}

//sin(x) or cos(x) at the precision of g: x reduced by the multiples of pi/2 to |r| <= pi/4, with the digits of x above
//its point added to g (the reduction loses them)
Decimal sinOrCos(const DecimalContext &context, const Decimal &x, bool cosine)
{
    if (context.isZero(x)) return context.integer(cosine ? 1 : 0);
    //The digits of x above its point, needed by the reduction, at most MORE_DIGITS (pi to them)
    const int64_t above = integerDigits(context, x);
    if (above > MORE_DIGITS) throw MathError(ErrorCode::NotSupported, "The decimal value needs more than " + std::to_string(MORE_DIGITS) + " digits beyond the ones asked (an argument too large for them)");
    const DecimalContext g(context.digits() + above + 15);
    const Decimal turns = g.roundToInteger(g.div(x, g.div(g.pi(), g.integer(2))));
    const Decimal four = g.integer(4);
    const long long quadrant = smallInteger(g.sub(turns, g.mul(four, g.floor(g.div(turns, four)))));
    //sin(r + q pi/2) is sin(r), cos(r), -sin(r), -cos(r); cos(t) is sin(t + pi/2)
    const long long shift = cosine ? (quadrant + 1) % 4 : quadrant;
    Decimal r = g.sub(x, g.mul(turns, g.div(g.pi(), g.integer(2))));
    //sin(r) of a small r (x near a multiple of pi): r again with its digits below the point more, the digits of the
    //value being below them
    const int64_t small = smallDigits(g, r);
    const DecimalContext h(g.digits() + (shift % 2 == 1 ? 0 : small));
    if (shift % 2 == 0 && small > 0) r = h.sub(x, h.mul(turns, h.div(h.pi(), h.integer(2))));
    Decimal value = sinCosSeries(h, r, shift % 2 == 1);
    if (shift >= 2) value = h.neg(value);
    return context.round(value);
}

}

Decimal DecimalContext::sin(const Decimal &a) const
{
    return sinOrCos(*this, a, false);
}

Decimal DecimalContext::cos(const Decimal &a) const
{
    return sinOrCos(*this, a, true);
}

Decimal DecimalContext::tan(const Decimal &a) const
{
    const DecimalContext g(digits() + 10);
    const Decimal cosine = g.cos(a);
    if (g.isZero(cosine)) notReal("the tangent of an odd multiple of pi/2");
    return round(g.div(g.sin(a), cosine));
}

Decimal DecimalContext::atan(const Decimal &a) const
{
    if (isZero(a)) return integer(0);
    if (isNegative(a)) return neg(atan(neg(a)));
    const DecimalContext g(digits() + 15);
    //atan(a) = pi/2 - atan(1/a) above 1
    if (compare(a, integer(1)) > 0) return round(g.sub(g.div(g.pi(), g.integer(2)), g.atan(g.div(g.integer(1), a))));
    //atan(x) = 2 atan(x / (1 + sqrt(1 + x^2))): halved below 10^-d (d = 2, more with the digits: a halving costs a
    //square root, a term of the series a product), then the series x - x^3/3 + x^5/5…
    Decimal x = g.round(a);
    long long doublings = 0;
    const long below = std::max(2L, static_cast<long>(std::sqrt(static_cast<double>(g.digits()) / 70)));
    const Decimal small = g.parse("1e-" + std::to_string(below));
    while (g.compare(x, small) > 0) {
        x = g.div(x, g.add(g.integer(1), g.sqrt(g.add(g.integer(1), g.mul(x, x)))));
        doublings++;
    }
    const Decimal square = g.mul(x, x);
    const Decimal limit = negligible(g);
    Decimal power = x;
    Decimal sum = x;
    for (long long k = 1;; k++) {
        power = g.neg(g.mul(power, square));
        const Decimal term = g.div(power, g.integer(2 * k + 1));
        if (g.compare(g.abs(term), limit) < 0) break;
        sum = g.add(sum, term);
        if (k % 128 == 0) checkpoint();
    }
    return round(g.mul(sum, g.pow(g.integer(2), g.integer(doublings))));
}

namespace {

//10^k ln 10 below a decimal: the k of e^a = 10^k e^(a - k ln 10)
long long tensBelow(double a)
{
    return static_cast<long long>(std::floor(a / 2.302585092994046));
}

}

Decimal DecimalContext::exp(const Decimal &a) const
{
    const double estimate = toDouble(a);
    //Beyond the exponents of the decimals: mpdecimal signals it
    if (digits() <= FAST_DIGITS || isZero(a) || !std::isfinite(estimate) || std::fabs(estimate) > 2e18) return libraryExp(a);
    //e^a = 10^k e^r, r = a - k ln 10 in [0, ln 10); e^r = (e^(r/2^m))^(2^m), the series of e^(r/2^m) short
    const long long k = tensBelow(estimate);
    const long halvings = static_cast<long>(std::ceil(std::sqrt(static_cast<double>(digits()) * 0.8)));
    const long more = static_cast<long>(std::to_string(k < 0 ? -k : k).size()) + static_cast<long>(halvings * 0.302) + 12;
    const DecimalContext g(digits() + more);
    const Decimal r = g.sub(a, g.mul(g.integer(k), g.ln10()));
    const Decimal y = g.div(r, g.pow(g.integer(2), g.integer(halvings)));
    const Decimal limit = negligible(g);
    Decimal term = y;
    Decimal sum = g.add(g.integer(1), y);
    for (long long j = 2;; j++) {
        term = g.div(g.mul(term, y), g.integer(j));
        if (g.compare(g.abs(term), limit) < 0) break;
        sum = g.add(sum, term);
        if (j % 64 == 0) checkpoint();
    }
    for (long i = 0; i < halvings; i++) sum = g.mul(sum, sum);
    return round(g.scaleb(sum, k));
}

Decimal DecimalContext::ln(const Decimal &a) const
{
    if (digits() <= FAST_DIGITS || isZero(a) || isNegative(a)) return libraryLn(a);
    if (compare(a, integer(1)) == 0) return integer(0);
    //a = x 10^e, x in [10^-1/2, 10^1/2): ln a = ln x + e ln 10
    int64_t e = exponent(a);
    Decimal x = scaleb(a, -e);
    if (compare(x, parse("3.16227766")) >= 0) {
        e++;
        x = scaleb(a, -e);
    }
    //ln x by Newton's iterations y + 2 (x - e^y)/(x + e^y), the digits tripling, from the logarithm in doubles; with the
    //digits of a small ln x below its point more, and those of e
    const int64_t target = digits() + 10 + smallDigits(*this, sub(x, integer(1))) + static_cast<int64_t>(std::to_string(e < 0 ? -e : e).size());
    Decimal y = parse(doubleText(std::log(toDouble(x))));
    for (int64_t precision = 45;; precision = std::min(precision * 3, target)) {
        const DecimalContext h(precision + 5);
        const Decimal power = h.exp(y);
        y = h.add(y, h.div(h.mul(h.integer(2), h.sub(x, power)), h.add(x, power)));
        if (precision >= target) break;
        checkpoint();
    }
    const DecimalContext g(target);
    return round(g.add(y, g.mul(g.integer(e), g.ln10())));
}

Decimal DecimalContext::pow(const Decimal &a, const Decimal &b) const
{
    if (digits() <= FAST_DIGITS || mpd_isinteger(b.get()) || isZero(a) || isNegative(a)) return libraryPow(a, b);
    //e^(b ln a), with the digits of b ln a above its point more (ln a has about those of the exponent of a)
    const int64_t first = exponent(a);
    const double size = std::log10(std::fabs(static_cast<double>(first)) * 2.302585092994046 + 3) + static_cast<double>(std::max<int64_t>(exponent(b), 0));
    const DecimalContext g(digits() + 10 + static_cast<int64_t>(std::ceil(size)));
    return round(g.exp(g.mul(b, g.ln(a))));
}

Decimal DecimalContext::sqrt(const Decimal &a) const
{
    if (digits() <= FAST_DIGITS || isZero(a) || isNegative(a)) return librarySqrt(a);
    //a = x 10^(2e), x in [1, 100): sqrt(a) = sqrt(x) 10^e; y = 1/sqrt(x) by Newton's iterations y + y (1 - x y^2)/2 (products
    //only), the digits doubling, then sqrt(x) = x y corrected once by y (x - (x y)^2)/2
    const int64_t first = exponent(a);
    const int64_t e = first >= 0 ? first / 2 : -((1 - first) / 2);
    const Decimal x = scaleb(a, -2 * e);
    const int64_t target = digits() + 10;
    const Decimal half = parse("0.5");
    Decimal y = parse(doubleText(1 / std::sqrt(toDouble(x))));
    for (int64_t precision = 30; precision < target; precision = std::min(precision * 2, target)) {
        const DecimalContext h(precision + 5);
        y = h.add(y, h.mul(h.mul(y, h.sub(h.integer(1), h.mul(x, h.mul(y, y)))), half));
    }
    const DecimalContext g(target + 5);
    const Decimal root = g.mul(x, y);
    return round(g.scaleb(g.add(root, g.mul(g.mul(y, g.sub(x, g.mul(root, root))), half)), e));
}

Decimal DecimalContext::log10(const Decimal &a) const
{
    if (digits() <= FAST_DIGITS || isZero(a) || isNegative(a)) return libraryLog10(a);
    //A power of 10: its exponent, exactly
    const Decimal reduced = reduce(a);
    if (reduced.get()->digits == 1 && mpd_lsd(reduced.get()->data[0]) == 1) return integer(exponent(a));
    const DecimalContext g(digits() + 10);
    return round(g.div(g.ln(a), g.ln10()));
}

Decimal DecimalContext::ln10() const
{
    //The ln 10 of the most digits computed in this thread: fewer digits are its rounding
    thread_local Decimal cached;
    thread_local long cachedDigits = 0;
    if (cachedDigits >= digits() + 10) return round(cached);
    //ln 10 = 6 atanh(1/3) + 2 atanh(1/9) (ln 2 = 2 atanh(1/3), ln 5/4 = 2 atanh(1/9)); atanh(1/q) = Σ 1/((2j + 1) q^(2j + 1))
    const DecimalContext g(digits() + 20);
    auto atanhInverse = [&g](long long q) {
        const Decimal square = g.integer(q * q);
        const Decimal limit = negligible(g);
        Decimal power = g.div(g.integer(1), g.integer(q));
        Decimal sum = power;
        for (long long j = 1;; j++) {
            power = g.div(power, square);
            const Decimal term = g.div(power, g.integer(2 * j + 1));
            if (g.compare(term, limit) < 0) break;
            sum = g.add(sum, term);
            if (j % 64 == 0) checkpoint();
        }
        return sum;
    };
    cached = g.add(g.mul(g.integer(6), atanhInverse(3)), g.mul(g.integer(2), atanhInverse(9)));
    cachedDigits = g.digits();
    return round(cached);
}

Decimal DecimalContext::asin(const Decimal &a) const
{
    const int size = compare(abs(a), integer(1));
    if (size > 0) notReal("asin of a number beyond 1");
    const DecimalContext g(digits() + 15);
    const Decimal halfPi = g.div(g.pi(), g.integer(2));
    if (size == 0) return round(isNegative(a) ? g.neg(halfPi) : halfPi);
    //asin(a) = atan(a / sqrt((1 - a)(1 + a)))
    const Decimal one = g.integer(1);
    return round(g.atan(g.div(a, g.sqrt(g.mul(g.sub(one, a), g.add(one, a))))));
}

Decimal DecimalContext::acos(const Decimal &a) const
{
    if (compare(abs(a), integer(1)) > 0) notReal("acos of a number beyond 1");
    const DecimalContext g(digits() + 15);
    if (compare(a, integer(-1)) == 0) return round(g.pi());
    //acos(a) = 2 atan(sqrt((1 - a)/(1 + a))): no cancellation near 1
    const Decimal one = g.integer(1);
    return round(g.mul(g.integer(2), g.atan(g.sqrt(g.div(g.sub(one, a), g.add(one, a))))));
}

Decimal DecimalContext::atan2(const Decimal &y, const Decimal &x) const
{
    const DecimalContext g(digits() + 15);
    if (isZero(x)) {
        if (isZero(y)) throw MathError(ErrorCode::Domain, "atan2(0, 0) has no value");
        const Decimal halfPi = g.div(g.pi(), g.integer(2));
        return round(isNegative(y) ? g.neg(halfPi) : halfPi);
    }
    const Decimal angle = g.atan(g.div(y, x));
    if (!isNegative(x)) return round(angle);
    return round(isNegative(y) ? g.sub(angle, g.pi()) : g.add(angle, g.pi()));
}

Decimal DecimalContext::sinh(const Decimal &a) const
{
    if (isZero(a)) return integer(0);
    const DecimalContext g(digits() + 15);
    //Below 1, the series a + a^3/3! + …: (e^a - e^-a)/2 cancels there
    if (compare(abs(a), integer(1)) < 0) {
        const Decimal square = g.mul(a, a);
        const Decimal limit = negligible(g);
        Decimal term = g.round(a);
        Decimal sum = term;
        for (long long power = 1;; power += 2) {
            term = g.div(g.mul(term, square), g.integer((power + 1) * (power + 2)));
            if (g.compare(g.abs(term), g.mul(limit, g.abs(sum))) < 0) break;
            sum = g.add(sum, term);
            if (power % 128 == 1) checkpoint();
        }
        return round(sum);
    }
    if (negligibleInverse(g, a)) return round(isNegative(a) ? g.neg(g.div(g.exp(g.abs(a)), g.integer(2))) : g.div(g.exp(a), g.integer(2)));
    const Decimal e = g.exp(a);
    return round(g.div(g.sub(e, g.div(g.integer(1), e)), g.integer(2)));
}

Decimal DecimalContext::cosh(const Decimal &a) const
{
    const DecimalContext g(digits() + 15);
    if (negligibleInverse(g, a)) return round(g.div(g.exp(g.abs(a)), g.integer(2)));
    const Decimal e = g.exp(a);
    return round(g.div(g.add(e, g.div(g.integer(1), e)), g.integer(2)));
}

Decimal DecimalContext::tanh(const Decimal &a) const
{
    if (isZero(a)) return integer(0);
    const DecimalContext g(digits() + 15);
    if (compare(abs(a), integer(1)) < 0) return round(g.div(g.sinh(a), g.cosh(a)));
    //1 - 2e^-2|a| within the last guard digit of 1
    if (negligibleInverse(g, a)) return integer(isNegative(a) ? -1 : 1);
    //(1 - e^-2|a|)/(1 + e^-2|a|), of the sign of a
    const Decimal e = g.exp(g.mul(g.integer(-2), abs(a)));
    const Decimal value = g.div(g.sub(g.integer(1), e), g.add(g.integer(1), e));
    return round(isNegative(a) ? g.neg(value) : value);
}

Decimal DecimalContext::asinh(const Decimal &a) const
{
    if (isZero(a)) return integer(0);
    if (isNegative(a)) return neg(asinh(neg(a)));
    //ln(a + sqrt(a^2 + 1)): ln(1 + a) of a small a loses its digits below 1
    const DecimalContext g(digits() + smallDigits(*this, a) + 15);
    return round(g.ln(g.add(a, g.sqrt(g.add(g.mul(a, a), g.integer(1))))));
}

Decimal DecimalContext::acosh(const Decimal &a) const
{
    const int size = compare(a, integer(1));
    if (size < 0) notReal("acosh of a number below 1");
    if (size == 0) return integer(0);
    const DecimalContext g(digits() + smallDigits(*this, sub(a, integer(1))) + 15);
    const Decimal one = g.integer(1);
    return round(g.ln(g.add(a, g.sqrt(g.mul(g.sub(a, one), g.add(a, one))))));
}

Decimal DecimalContext::atanh(const Decimal &a) const
{
    if (compare(abs(a), integer(1)) >= 0) notReal("atanh of a number not between -1 and 1");
    if (isZero(a)) return integer(0);
    //ln((1 + a)/(1 - a))/2
    const DecimalContext g(digits() + smallDigits(*this, a) + 15);
    const Decimal one = g.integer(1);
    return round(g.div(g.ln(g.div(g.add(one, a), g.sub(one, a))), g.integer(2)));
}

Decimal DecimalContext::eulerGamma() const
{
    //Brent and McMillan: B(k) = (n^k/k!)^2, A(k) = (A(k - 1) n^2/k + B(k))/k from A(0) = -ln(n), γ = ΣA/ΣB within
    //pi e^(-4n); the terms grow to e^(2n) before they fall, their digits added
    const long n = static_cast<long>(std::ceil(digits() * 2.302585092994046 / 4)) + 2;
    const DecimalContext g(digits() + static_cast<long>(std::ceil(2 * n / 2.302585092994046)) + 15);
    const Decimal square = g.integer(static_cast<long long>(n) * n);
    const Decimal limit = negligible(g);
    Decimal a = g.neg(g.ln(g.integer(n)));
    Decimal b = g.integer(1);
    Decimal u = a;
    Decimal v = b;
    for (long long k = 1;; k++) {
        b = g.div(g.mul(b, square), g.integer(k * k));
        a = g.div(g.add(g.div(g.mul(a, square), g.integer(k)), b), g.integer(k));
        u = g.add(u, a);
        v = g.add(v, b);
        if (k > n && g.compare(g.abs(b), g.mul(limit, v)) < 0 && g.compare(g.abs(a), g.mul(limit, g.abs(u))) < 0) break;
        if (k % 64 == 0) checkpoint();
    }
    return round(g.div(u, v));
}

Decimal DecimalContext::catalan() const
{
    //Ramanujan: G = pi/8 ln(2 + sqrt(3)) + 3/8 Σ (n!)^2/((2n)! (2n + 1)^2)
    const DecimalContext g(digits() + 15);
    const Decimal limit = negligible(g);
    Decimal coefficient = g.integer(1);
    Decimal sum = g.integer(0);
    for (long long n = 0;; n++) {
        const Decimal term = g.div(coefficient, g.integer((2 * n + 1) * (2 * n + 1)));
        if (g.compare(term, limit) < 0) break;
        sum = g.add(sum, term);
        coefficient = g.div(g.mul(coefficient, g.integer(n + 1)), g.integer(2 * (2 * n + 1)));
        if (n % 128 == 0) checkpoint();
    }
    const Decimal logarithm = g.ln(g.add(g.integer(2), g.sqrt(g.integer(3))));
    return round(g.add(g.div(g.mul(g.pi(), logarithm), g.integer(8)), g.div(g.mul(g.integer(3), sum), g.integer(8))));
}

}
