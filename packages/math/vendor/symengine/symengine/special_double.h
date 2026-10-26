// lakutata: the values of the special functions in double precision, for real and complex arguments, where the
// standard library has none (zeta, Lambert W, polygamma, the incomplete gamma functions, beta) or only real ones
// (gamma, log gamma, erf, erfc). SymEngine computes them with MPFR and Arb, which the addon does not use. The real
// functions return NaN where the value is not real, so that the caller evaluates in the complex numbers instead.
#ifndef SYMENGINE_SPECIAL_DOUBLE_H
#define SYMENGINE_SPECIAL_DOUBLE_H

#include <algorithm>
#include <cmath>
#include <complex>
#include <limits>
#include <type_traits>
#include <unordered_map>

namespace SymEngine
{
namespace special
{

using complex = std::complex<double>;

constexpr double PI = 3.141592653589793238462643383279502884;
constexpr double E = 2.718281828459045235360287471352662498;
constexpr double NAN_VALUE = std::numeric_limits<double>::quiet_NaN();
constexpr double INF = std::numeric_limits<double>::infinity();

// B(2k) / (2k)!, k = 1..12: the coefficients of the Euler-Maclaurin sums
constexpr double BERNOULLI_FACTORIAL[] = {
    1.0 / 12, -1.0 / 720, 1.0 / 30240, -1.0 / 1209600, 1.0 / 47900160, -691.0 / 1307674368000.0,
    1.0 / 74724249600.0, -3617.0 / 10670622842880000.0, 43867.0 / 5109094217170944000.0,
    -174611.0 / 802857662698291200000.0, 77683.0 / 14101100039391805440000.0,
    -236364091.0 / 1693824136731743669452800000.0};
// B(2k), k = 1..12
constexpr double BERNOULLI[] = {1.0 / 6, -1.0 / 30, 1.0 / 42, -1.0 / 30, 5.0 / 66, -691.0 / 2730, 7.0 / 6,
                                -3617.0 / 510, 43867.0 / 798, -174611.0 / 330, 854513.0 / 138,
                                -236364091.0 / 2730};

// lakutata: an inverse function of a real argument computed by its real version where it is real: the complex
// versions may leave tiny imaginary parts (libc++'s std::atan(-0.4 + 0i) has 5.55e-17), which move arg() and the
// roots of the results across their cuts
// lakutata: values given for some nodes of the expression being evaluated, in this thread (the real parts the
// decimals of the addon computed): the evaluations take them instead of computing the nodes
inline thread_local const std::unordered_map<const void *, double> *given_values = nullptr;

// lakutata: the maximum and the minimum of real values, NaN when one of them is (a part with no real value: the
// complex evaluation is tried then); std::max and std::min dropped a NaN after the first value
inline double max_of(double a, double b)
{
    return std::isnan(a) or std::isnan(b) ? std::numeric_limits<double>::quiet_NaN() : std::max(a, b);
}

inline double min_of(double a, double b)
{
    return std::isnan(a) or std::isnan(b) ? std::numeric_limits<double>::quiet_NaN() : std::min(a, b);
}

// lakutata: a value on a branch cut moved to the side the exact values take (SymPy's, counter-clockwise continuous,
// on which SymEngine's asinh(-z) = -asinh(z) relies): the complex functions read the side of a cut from the sign of
// a zero, and the evaluations have no negative zeros (the upper or right side). asin and acos right of 1, atanh left
// of -1: from below; atan and asinh below -i: from the left.
inline std::complex<double> below_beyond_one(const std::complex<double> &z)
{
    return z.imag() == 0 and z.real() > 1 ? std::complex<double>(z.real(), -0.0)
                                           : z;
}

inline std::complex<double> below_before_minus_one(const std::complex<double> &z)
{
    return z.imag() == 0 and z.real() < -1 ? std::complex<double>(z.real(), -0.0)
                                            : z;
}

inline std::complex<double> left_below_minus_i(const std::complex<double> &z)
{
    return z.real() == 0 and z.imag() < -1 ? std::complex<double>(-0.0, z.imag())
                                            : z;
}

template <typename F, typename G, typename D>
inline double real_where(double x, F real, G, D)
{
    return real(x);
}

template <typename F, typename G, typename D>
inline std::complex<double> real_where(const std::complex<double> &z, F real,
                                       G complex, D inside)
{
    if (z.imag() == 0 and inside(z.real()))
        return real(z.real());
    return complex(z);
}

// A value without its negative zeros: a negative real number stays on the
// upper side of the branch cuts, as the exact values (the principal ones):
// (0.9 + 0i)/(-0.4 + 0i) is -2.25 - 0i, its log was -i*pi
inline double unsigned_zeros(double x)
{
    return x + 0.0;
}

inline complex unsigned_zeros(const complex &z)
{
    return {z.real() + 0.0, z.imag() + 0.0};
}

// z**n for an integer n, by multiplications (binary exponentiation): pow of
// complex numbers goes through exp and log, whose rounding moved real values
// off the real line ((-1.9)**-1 had an imaginary part of -1e-16)
template <typename T>
T integer_power(T z, long n)
{
    const bool negative = n < 0;
    unsigned long m = negative ? 0ul - static_cast<unsigned long>(n) : static_cast<unsigned long>(n);
    T result = 1;
    while (m > 0) {
        if (m & 1)
            result *= z;
        z *= z;
        m >>= 1;
    }
    return negative ? T(1) / result : result;
}

// A complex result given as a real one (NaN when it is not real) or as itself
inline void assign(double &out, const complex &z)
{
    out = z.imag() == 0 ? z.real() : NAN_VALUE;
}

inline void assign(complex &out, const complex &z)
{
    out = z;
}

inline bool is_nonpositive_integer(double x)
{
    return x <= 0 && x == std::floor(x);
}

inline bool is_nonpositive_integer(const complex &z)
{
    return z.imag() == 0 && is_nonpositive_integer(z.real());
}

// Gamma: Lanczos (g = 7, 9 terms), the reflection formula left of 1/2
inline complex gamma(complex z)
{
    static const double p[] = {0.99999999999980993, 676.5203681218851, -1259.1392167224028,
                               771.32342877765313, -176.61502916214059, 12.507343278686905,
                               -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7};
    if (z.imag() == 0)
        return std::tgamma(z.real());
    if (z.real() < 0.5)
        return PI / (std::sin(PI * z) * gamma(1.0 - z));
    z -= 1.0;
    complex sum = p[0];
    for (int i = 1; i < 9; i++)
        sum += p[i] / (z + double(i));
    const complex t = z + 7.5;
    return std::sqrt(2 * PI) * std::pow(t, z + 0.5) * std::exp(-t) * sum;
}

// The logarithm of gamma, analytic continuation of the real one (its branch
// cut on the negative real axis): Stirling's series after moving the argument
// right by the recurrence
inline complex loggamma(complex z)
{
    if (is_nonpositive_integer(z))
        return INF;
    if (z.imag() == 0 && z.real() > 0)
        return std::lgamma(z.real());
    complex shift = 0;
    while (z.real() < 15) {
        shift += std::log(z);
        z += 1.0;
    }
    const complex w2 = z * z;
    complex power = z, series = 0;
    for (int k = 1; k <= 8; k++) {
        series += BERNOULLI[k - 1] / ((2.0 * k) * (2.0 * k - 1) * power);
        power *= w2;
    }
    return (z - 0.5) * std::log(z) - z + 0.5 * std::log(2 * PI) + series - shift;
}

inline double loggamma(double x)
{
    // Not real left of zero: the imaginary part is a multiple of pi
    return x > 0 ? std::lgamma(x) : NAN_VALUE;
}

// Polygamma of order n (digamma for n = 0): the recurrence to move the
// argument right, then the asymptotic series
template <typename T>
T polygamma(unsigned n, T z)
{
    if (is_nonpositive_integer(z))
        return n % 2 == 0 && n > 0 ? T(INF) : T(NAN_VALUE);
    double factorial = 1;
    for (unsigned i = 2; i <= n; i++)
        factorial *= i;
    T shift = 0;
    while (std::real(z) < 20.0 + n) {
        shift += 1.0 / std::pow(z, double(n + 1));
        z += 1.0;
    }
    if (n == 0) {
        const T w2 = z * z;
        T power = w2, series = 0;
        for (int k = 1; k <= 10; k++) {
            series += BERNOULLI[k - 1] / (2.0 * k * power);
            power *= w2;
        }
        return std::log(z) - 0.5 / z - series - shift;
    }
    // (-1)^(n+1) [(n-1)!/z^n + n!/(2 z^(n+1)) + sum B(2k) (2k+n-1)!/((2k)! z^(2k+n))]
    const double sign = n % 2 == 1 ? 1 : -1;
    T series = (factorial / n) / std::pow(z, double(n)) + factorial / (2.0 * std::pow(z, double(n + 1)));
    double rising = factorial; // (2k+n-1)!/(2k)! built from n!
    T power = std::pow(z, double(n + 2));
    const T w2 = z * z;
    for (int k = 1; k <= 10; k++) {
        // (2k+n-1)! / (2k)! = (n-1+2k)! / (2k)!: multiply by (n+2k-1)(n+2k-2) / ((2k)(2k-1)) from k-1
        rising = k == 1 ? factorial * (n + 1) / 2.0
                        : rising * (n + 2.0 * k - 1) * (n + 2.0 * k - 2) / ((2.0 * k) * (2.0 * k - 1));
        series += BERNOULLI[k - 1] * rising / power;
        power *= w2;
    }
    return sign * series + sign * factorial * shift;
}

// 1 - 2^(1-s), accurate near s = 1
inline double one_minus_power_of_two(double s)
{
    return -std::expm1((1 - s) * std::log(2.0));
}

inline complex one_minus_power_of_two(const complex &s)
{
    const complex w = (1.0 - s) * std::log(2.0);
    if (std::abs(w) < 1e-3)
        return -(w + w * w / 2.0 + w * w * w / 6.0 + w * w * w * w / 24.0);
    return 1.0 - std::exp(w);
}

inline double gamma_of(double x)
{
    return std::tgamma(x);
}

inline complex gamma_of(const complex &z)
{
    return gamma(z);
}

// The Hurwitz zeta function (the Riemann one for a = 1): the reflection
// formula left of 1/2 for the Riemann one, else the Euler-Maclaurin sum
template <typename T>
T zeta(T s, T a = T(1))
{
    if (s == T(1))
        return T(INF);
    if (is_nonpositive_integer(a))
        return T(NAN_VALUE);
    const bool riemann = a == T(1);
    if (riemann && std::real(s) < 0.5)
        return std::pow(T(2), s) * std::pow(T(PI), s - 1.0) * std::sin(PI * s / 2.0) * gamma_of(1.0 - s)
               * zeta(1.0 - s);
    if (!riemann && std::real(a) <= 0)
        return T(NAN_VALUE);
    const int terms = 15 + int(std::abs(s));
    T sum = 0;
    for (int k = 0; k < terms; k++)
        sum += std::pow(a + double(k), -s);
    const T w = a + double(terms);
    sum += std::pow(w, 1.0 - s) / (s - 1.0) + 0.5 * std::pow(w, -s);
    // sum of B(2j)/(2j)! s(s+1)...(s+2j-2) w^(-s-2j+1)
    T rising = s, power = std::pow(w, -s - 1.0);
    const T w2 = w * w;
    for (int j = 1; j <= 12; j++) {
        sum += BERNOULLI_FACTORIAL[j - 1] * rising * power;
        rising *= (s + (2.0 * j - 1)) * (s + 2.0 * j);
        power /= w2;
    }
    return sum;
}

// The Dirichlet eta function
template <typename T>
T dirichlet_eta(T s)
{
    if (s == T(1))
        return T(std::log(2.0));
    return one_minus_power_of_two(s) * zeta(s);
}

// The principal branch of the Lambert W function: Halley's iteration from a
// guess near the branch point, by the logarithm, or by the asymptotic series
template <typename T>
T lambertw(T x)
{
    if (x == T(0))
        return T(0);
    if constexpr (std::is_same<T, double>::value) {
        if (x < -1 / E)
            return NAN_VALUE;
    }
    T w;
    const T p2 = 2.0 * (E * x + 1.0);
    if (std::abs(p2) < 2) {
        // Near the branch point -1/e
        const T p = std::sqrt(p2);
        w = -1.0 + p - p * p / 3.0 + 11.0 / 72.0 * p * p * p;
    } else if (std::abs(x) > 3 || std::real(x) < 0) {
        // The asymptotic series keeps the principal branch left of zero too
        const T l1 = std::log(x), l2 = std::log(l1);
        w = l1 - l2 + l2 / l1;
    } else {
        w = std::log(1.0 + x);
    }
    for (int i = 0; i < 100; i++) {
        const T ew = std::exp(w);
        const T f = w * ew - x;
        const T step = f / (ew * (w + 1.0) - (w + 2.0) * f / (2.0 * w + 2.0));
        w -= step;
        if (std::abs(step) <= 1e-16 * (1 + std::abs(w)))
            break;
    }
    return w;
}

// The incomplete gamma functions of a real s > 0 and x >= 0, regularized: P
// by its series below s + 1, Q by its continued fraction above (Lentz)
inline double lower_series(double s, double x)
{
    double term = 1 / s, sum = term;
    for (int n = 1; n < 1000; n++) {
        term *= x / (s + n);
        sum += term;
        if (std::abs(term) < std::abs(sum) * 1e-17)
            break;
    }
    return sum * std::exp(-x + s * std::log(x) - std::lgamma(s));
}

inline double upper_fraction(double s, double x)
{
    const double tiny = 1e-300;
    double b = x + 1 - s, c = 1 / tiny, d = 1 / b, h = d;
    for (int i = 1; i < 1000; i++) {
        const double an = -i * (i - s);
        b += 2;
        d = an * d + b;
        if (std::abs(d) < tiny)
            d = tiny;
        c = b + an / c;
        if (std::abs(c) < tiny)
            c = tiny;
        d = 1 / d;
        const double delta = d * c;
        h *= delta;
        if (std::abs(delta - 1) < 1e-16)
            break;
    }
    return std::exp(-x + s * std::log(x) - std::lgamma(s)) * h;
}

inline double lower_gamma(double s, double x)
{
    if (s <= 0 || x < 0)
        return NAN_VALUE;
    if (x == 0)
        return 0;
    return std::tgamma(s) * (x < s + 1 ? lower_series(s, x) : 1 - upper_fraction(s, x));
}

inline double upper_gamma(double s, double x)
{
    if (s <= 0 || x < 0)
        return NAN_VALUE;
    if (x == 0)
        return std::tgamma(s);
    return std::tgamma(s) * (x < s + 1 ? 1 - lower_series(s, x) : upper_fraction(s, x));
}

inline complex lower_gamma(const complex &s, const complex &x)
{
    if (s.imag() == 0 && x.imag() == 0)
        return lower_gamma(s.real(), x.real());
    return NAN_VALUE;
}

inline complex upper_gamma(const complex &s, const complex &x)
{
    if (s.imag() == 0 && x.imag() == 0)
        return upper_gamma(s.real(), x.real());
    return NAN_VALUE;
}

// Beta
inline double beta(double a, double b)
{
    if (a > 0 && b > 0)
        return std::exp(std::lgamma(a) + std::lgamma(b) - std::lgamma(a + b));
    return std::tgamma(a) * std::tgamma(b) / std::tgamma(a + b);
}

inline complex beta(const complex &a, const complex &b)
{
    if (a.imag() == 0 && b.imag() == 0)
        return beta(a.real(), b.real());
    return std::exp(loggamma(a) + loggamma(b) - loggamma(a + b));
}

// erf and erfc of a complex argument: the Taylor series near zero, the
// continued fraction of erfc right of the imaginary axis
inline complex erfc(complex z);

inline complex erf(complex z)
{
    if (z.imag() == 0)
        return std::erf(z.real());
    if (std::abs(z) >= 2 && std::abs(z.real()) > 0.5)
        return 1.0 - erfc(z);
    complex term = z, sum = z;
    const complex z2 = z * z;
    for (int n = 1; n < 500; n++) {
        term *= -z2 / double(n);
        const complex add = term / (2.0 * n + 1);
        sum += add;
        if (std::abs(add) < 1e-17 * std::abs(sum))
            break;
    }
    return 2 / std::sqrt(PI) * sum;
}

inline complex erfc(complex z)
{
    if (z.imag() == 0)
        return std::erfc(z.real());
    if (z.real() < 0)
        return 2.0 - erfc(-z);
    if (std::abs(z) < 2 || z.real() <= 0.5)
        return 1.0 - erf(z);
    // erfc(z) = exp(-z^2)/sqrt(pi) / (z + (1/2)/(z + 1/(z + (3/2)/(z + ...))))
    const double tiny = 1e-300;
    complex f = z, c = z, d = 0;
    for (int k = 1; k < 2000; k++) {
        const double a = k / 2.0;
        d = z + a * d;
        if (std::abs(d) < tiny)
            d = tiny;
        c = z + a / c;
        if (std::abs(c) < tiny)
            c = tiny;
        d = 1.0 / d;
        const complex delta = c * d;
        f *= delta;
        if (std::abs(delta - 1.0) < 1e-16)
            break;
    }
    return std::exp(-z * z) / std::sqrt(PI) / f;
}

// The sign, floor, ceiling and truncation: of each part of a complex number
// (sign(z) is z/|z|)
inline double sign(double x)
{
    // NaN stays NaN: the value is not real, the complex one is computed then
    return std::isnan(x) ? x : (x > 0 ? 1 : (x < 0 ? -1 : 0));
}

inline complex sign(const complex &z)
{
    return z == 0.0 ? complex(0) : z / std::abs(z);
}

inline double floor(double x)
{
    return std::floor(x);
}

inline complex floor(const complex &z)
{
    return {std::floor(z.real()), std::floor(z.imag())};
}

inline double ceiling(double x)
{
    return std::ceil(x);
}

inline complex ceiling(const complex &z)
{
    return {std::ceil(z.real()), std::ceil(z.imag())};
}

inline double truncate(double x)
{
    return std::trunc(x);
}

inline complex truncate(const complex &z)
{
    return {std::trunc(z.real()), std::trunc(z.imag())};
}

inline double conjugate(double x)
{
    return x;
}

inline complex conjugate(const complex &z)
{
    return std::conj(z);
}

} // namespace special
} // namespace SymEngine

#endif
