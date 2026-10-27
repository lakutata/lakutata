//The probability distributions on Boost.Math, with the conventions of SciPy where Boost has others: the values outside
//the support (a density of 0, a cdf of 0 or 1, where Boost gives NaN), the values of a discrete distribution that are
//not integers (a mass of 0, the cdf of the integer below, where Boost interpolates), the quantile of a discrete
//distribution as the smallest k of cdf(k) >= p (checked against the cdf: Boost's geometric quantile is continuous), the
//geometric distribution as the number of trials up to the first success (Boost counts the failures before it), the
//means and variances whose integrals diverge as infinities (Boost's are NaN). Their parameters are checked by Boost
//with a policy that throws; their values computed with the policy of the addon.
#include "Distributions.h"

#include <cmath>
#include <limits>
#include <type_traits>
#include <utility>

#include <boost_math_policy.h>

#include <boost/math/distributions/bernoulli.hpp>
#include <boost/math/distributions/beta.hpp>
#include <boost/math/distributions/binomial.hpp>
#include <boost/math/distributions/cauchy.hpp>
#include <boost/math/distributions/chi_squared.hpp>
#include <boost/math/distributions/exponential.hpp>
#include <boost/math/distributions/extreme_value.hpp>
#include <boost/math/distributions/fisher_f.hpp>
#include <boost/math/distributions/gamma.hpp>
#include <boost/math/distributions/geometric.hpp>
#include <boost/math/distributions/hypergeometric.hpp>
#include <boost/math/distributions/inverse_gamma.hpp>
#include <boost/math/distributions/laplace.hpp>
#include <boost/math/distributions/logistic.hpp>
#include <boost/math/distributions/lognormal.hpp>
#include <boost/math/distributions/negative_binomial.hpp>
#include <boost/math/distributions/normal.hpp>
#include <boost/math/distributions/pareto.hpp>
#include <boost/math/distributions/poisson.hpp>
#include <boost/math/distributions/rayleigh.hpp>
#include <boost/math/distributions/students_t.hpp>
#include <boost/math/distributions/triangular.hpp>
#include <boost/math/distributions/uniform.hpp>
#include <boost/math/distributions/weibull.hpp>

#include "../core/Errors.h"

namespace math {

namespace {

using Policy = lakutata::BoostPolicy;

//The policy of the addon, but a parameter outside its domain throws: for the check of the parameters
using CheckingPolicy = boost::math::policies::policy<
    boost::math::policies::domain_error<boost::math::policies::throw_on_error>,
    boost::math::policies::pole_error<boost::math::policies::ignore_error>,
    boost::math::policies::overflow_error<boost::math::policies::ignore_error>,
    boost::math::policies::evaluation_error<boost::math::policies::ignore_error>,
    boost::math::policies::rounding_error<boost::math::policies::ignore_error>,
    boost::math::policies::promote_float<false>,
    boost::math::policies::promote_double<false>,
    boost::math::policies::discrete_quantile<boost::math::policies::integer_round_up>>;

constexpr double NOT_A_NUMBER = std::numeric_limits<double>::quiet_NaN();
constexpr double INFINITE = std::numeric_limits<double>::infinity();

//How a distribution of Boost is read: discrete or not, and the shift of its values (1 for the geometric one)
struct Kind {
    bool discrete = false;
    double shift = 0;
};

void requireCount(const std::vector<double> &parameters, size_t count, const std::string &name)
{
    if (parameters.size() != count) throw MathError(ErrorCode::Argument, "The " + name + " distribution takes " + std::to_string(count) + " parameters");
}

void requireInteger(double value, const char *what, const std::string &name)
{
    if (!(value >= 0) || value != std::floor(value) || value > 4294967295.0) throw MathError(ErrorCode::Argument, std::string("The ") + what + " of the " + name + " distribution is an integer of 0 or more");
}

//The distribution of Boost of a name and its parameters, given to a function with how to read it
template <typename P, typename F>
auto withDistribution(const std::string &name, const std::vector<double> &p, F &&function)
{
    namespace bm = boost::math;
    const Kind continuous{false, 0}, discrete{true, 0};
    if (name == "normal") return requireCount(p, 2, name), function(bm::normal_distribution<double, P>(p[0], p[1]), continuous);
    if (name == "lognormal") return requireCount(p, 2, name), function(bm::lognormal_distribution<double, P>(p[0], p[1]), continuous);
    if (name == "uniform") return requireCount(p, 2, name), function(bm::uniform_distribution<double, P>(p[0], p[1]), continuous);
    if (name == "exponential") return requireCount(p, 1, name), function(bm::exponential_distribution<double, P>(p[0]), continuous);
    if (name == "gamma") return requireCount(p, 2, name), function(bm::gamma_distribution<double, P>(p[0], p[1]), continuous);
    if (name == "beta") return requireCount(p, 2, name), function(bm::beta_distribution<double, P>(p[0], p[1]), continuous);
    if (name == "chiSquared") return requireCount(p, 1, name), function(bm::chi_squared_distribution<double, P>(p[0]), continuous);
    if (name == "studentT") return requireCount(p, 1, name), function(bm::students_t_distribution<double, P>(p[0]), continuous);
    if (name == "fisherF") return requireCount(p, 2, name), function(bm::fisher_f_distribution<double, P>(p[0], p[1]), continuous);
    if (name == "cauchy") return requireCount(p, 2, name), function(bm::cauchy_distribution<double, P>(p[0], p[1]), continuous);
    if (name == "laplace") return requireCount(p, 2, name), function(bm::laplace_distribution<double, P>(p[0], p[1]), continuous);
    if (name == "logistic") return requireCount(p, 2, name), function(bm::logistic_distribution<double, P>(p[0], p[1]), continuous);
    if (name == "weibull") return requireCount(p, 2, name), function(bm::weibull_distribution<double, P>(p[0], p[1]), continuous);
    if (name == "pareto") return requireCount(p, 2, name), function(bm::pareto_distribution<double, P>(p[0], p[1]), continuous);
    if (name == "rayleigh") return requireCount(p, 1, name), function(bm::rayleigh_distribution<double, P>(p[0]), continuous);
    if (name == "triangular") {
        requireCount(p, 3, name);
        if (!(p[0] <= p[1] && p[1] <= p[2] && p[0] < p[2])) throw MathError(ErrorCode::Argument, "The triangular distribution needs lower <= mode <= upper, and lower < upper");
        return function(bm::triangular_distribution<double, P>(p[0], p[1], p[2]), continuous);
    }
    if (name == "gumbel") return requireCount(p, 2, name), function(bm::extreme_value_distribution<double, P>(p[0], p[1]), continuous);
    if (name == "inverseGamma") return requireCount(p, 2, name), function(bm::inverse_gamma_distribution<double, P>(p[0], p[1]), continuous);
    if (name == "bernoulli") return requireCount(p, 1, name), function(bm::bernoulli_distribution<double, P>(p[0]), discrete);
    if (name == "binomial") {
        requireCount(p, 2, name);
        requireInteger(p[0], "number of trials", name);
        return function(bm::binomial_distribution<double, P>(p[0], p[1]), discrete);
    }
    if (name == "poisson") return requireCount(p, 1, name), function(bm::poisson_distribution<double, P>(p[0]), discrete);
    if (name == "geometric") return requireCount(p, 1, name), function(bm::geometric_distribution<double, P>(p[0]), Kind{true, 1});
    if (name == "negativeBinomial") return requireCount(p, 2, name), function(bm::negative_binomial_distribution<double, P>(p[0], p[1]), discrete);
    if (name == "hypergeometric") {
        //Of a population of total items, successes of them, draws: Boost's (successes, draws, total)
        requireCount(p, 3, name);
        requireInteger(p[0], "size of the population", name);
        requireInteger(p[1], "number of successes", name);
        requireInteger(p[2], "number of draws", name);
        if (p[1] > p[0] || p[2] > p[0]) throw MathError(ErrorCode::Argument, "The hypergeometric distribution needs at least as many items in its population as successes, and as draws");
        return function(bm::hypergeometric_distribution<double, P>(static_cast<unsigned>(p[1]), static_cast<unsigned>(p[2]), static_cast<unsigned>(p[0])), discrete);
    }
    throw MathError(ErrorCode::Argument, "Unknown distribution: " + name);
}

void check(const std::string &name, const std::vector<double> &parameters)
{
    for (const double parameter : parameters) {
        if (!std::isfinite(parameter)) throw MathError(ErrorCode::Argument, "A parameter of the " + name + " distribution is not finite");
    }
    try {
        withDistribution<CheckingPolicy>(name, parameters, [](const auto &, Kind) { return 0; });
    } catch (const std::domain_error &error) {
        //Boost's reason, after the name of its function: "Scale parameter is -1, but must be > 0 !"
        std::string reason = error.what();
        const size_t colon = reason.find(": ");
        if (colon != std::string::npos) reason = reason.substr(colon + 2);
        while (!reason.empty() && (reason.back() == '!' || reason.back() == ' ')) reason.pop_back();
        throw MathError(ErrorCode::Argument, "The parameters of the " + name + " distribution are not valid: " + reason);
    }
}

template <typename D>
struct IsCauchy : std::false_type {};
template <typename P>
struct IsCauchy<boost::math::cauchy_distribution<double, P>> : std::true_type {};

//The support, shifted: its infinite bounds as infinities (Boost gives the largest doubles), the bounds of its open
//intervals at 0 as 0 (Boost gives the smallest normal double, as the lower bound of the exponential distribution)
template <typename D>
std::pair<double, double> supportOf(const D &distribution, Kind kind)
{
    const auto bounds = boost::math::support(distribution);
    const double largest = std::numeric_limits<double>::max(), smallest = std::numeric_limits<double>::min();
    const auto bound = [&](double value) {
        if (std::abs(value) >= largest) return value > 0 ? INFINITE : -INFINITE;
        if (std::abs(value) == smallest) return 0.0;
        return value + kind.shift;
    };
    return {bound(bounds.first), bound(bounds.second)};
}

template <typename D>
double pdfAt(const D &distribution, Kind kind, double x)
{
    if (std::isnan(x)) return NOT_A_NUMBER;
    const auto [lower, upper] = supportOf(distribution, kind);
    if (x < lower || x > upper || std::isinf(x)) return 0;
    if (kind.discrete && x != std::floor(x)) return 0;
    return boost::math::pdf(distribution, x - kind.shift);
}

template <typename D>
double cdfAt(const D &distribution, Kind kind, double x)
{
    if (std::isnan(x)) return NOT_A_NUMBER;
    const auto [lower, upper] = supportOf(distribution, kind);
    if (x < lower) return 0;
    if (x >= upper) return 1;
    if (kind.discrete) x = std::floor(x);
    return boost::math::cdf(distribution, x - kind.shift);
}

template <typename D>
double survivalAt(const D &distribution, Kind kind, double x)
{
    if (std::isnan(x)) return NOT_A_NUMBER;
    const auto [lower, upper] = supportOf(distribution, kind);
    if (x < lower) return 1;
    if (x >= upper) return 0;
    if (kind.discrete) x = std::floor(x);
    return boost::math::cdf(boost::math::complement(distribution, x - kind.shift));
}

//The smallest integer k of [lower, upper] where a condition, false then true as k grows, holds: from a guess, by
//steps that double, then by bisection
template <typename Holds>
double smallestWhere(Holds holds, double guess, double lower, double upper)
{
    double k = std::isfinite(guess) ? std::ceil(guess) : (std::isfinite(lower) ? lower : 0);
    if (k < lower) k = lower;
    if (k > upper) k = upper;
    double below, above;
    if (holds(k)) {
        //Down to a k where it does not hold
        above = k;
        double step = 1;
        below = k - step;
        while (below >= lower && holds(below)) {
            above = below;
            step *= 2;
            below = std::max(k - step, lower - 1);
        }
        //Past the support: it holds at its lower bound, or the lower bound is where it does not
        if (below < lower) {
            if (holds(lower)) return lower;
            below = lower;
        }
    } else {
        below = k;
        double step = 1;
        above = k + step;
        while (above <= upper && !holds(above)) {
            below = above;
            step *= 2;
            above = std::min(k + step, upper + 1);
        }
        //Past the support: its upper bound, where it holds (a cdf of 1, a survival of 0)
        if (above > upper) {
            if (below >= upper) return upper;
            above = upper;
        }
    }
    //holds(above), not holds(below)
    while (above - below > 1) {
        const double middle = std::floor(below + (above - below) / 2);
        if (holds(middle)) above = middle;
        else below = middle;
    }
    return above;
}

template <typename D>
double quantileAt(const D &distribution, Kind kind, double p)
{
    if (!(p >= 0 && p <= 1)) return NOT_A_NUMBER;
    const auto [lower, upper] = supportOf(distribution, kind);
    if (p == 0) return lower;
    if (p == 1) return upper;
    const double guess = boost::math::quantile(distribution, p) + kind.shift;
    if (!kind.discrete) return guess;
    return smallestWhere([&](double k) { return cdfAt(distribution, kind, k) >= p; }, guess, lower, upper);
}

template <typename D>
double survivalQuantileAt(const D &distribution, Kind kind, double q)
{
    if (!(q >= 0 && q <= 1)) return NOT_A_NUMBER;
    const auto [lower, upper] = supportOf(distribution, kind);
    if (q == 0) return upper;
    if (q == 1) return lower;
    const double guess = boost::math::quantile(boost::math::complement(distribution, q)) + kind.shift;
    if (!kind.discrete) return guess;
    return smallestWhere([&](double k) { return survivalAt(distribution, kind, k) <= q; }, guess, lower, upper);
}

//xoshiro256** (Blackman and Vigna)
uint64_t rotate(uint64_t x, int k)
{
    return (x << k) | (x >> (64 - k));
}

uint64_t nextOf(uint64_t s[4])
{
    const uint64_t result = rotate(s[1] * 5, 7) * 9;
    const uint64_t t = s[1] << 17;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotate(s[3], 45);
    return result;
}

//A uniform number of (0, 1): 53 bits, centered in their interval (never 0 nor 1)
double uniformOf(uint64_t s[4])
{
    return (static_cast<double>(nextOf(s) >> 11) + 0.5) * 0x1.0p-53;
}

}

std::vector<double> describeDistribution(const std::string &name, const std::vector<double> &parameters)
{
    check(name, parameters);
    return withDistribution<Policy>(name, parameters, [](const auto &distribution, Kind kind) {
        using D = std::decay_t<decltype(distribution)>;
        const auto [lower, upper] = supportOf(distribution, kind);
        double mean = NOT_A_NUMBER, variance = NOT_A_NUMBER, skewness = NOT_A_NUMBER, kurtosis = NOT_A_NUMBER;
        if constexpr (!IsCauchy<D>::value) {
            mean = boost::math::mean(distribution) + kind.shift;
            variance = boost::math::variance(distribution);
            skewness = boost::math::skewness(distribution);
            kurtosis = boost::math::kurtosis_excess(distribution);
        }
        //A mean or a variance Boost leaves undefined (NaN, or the largest double) where its integral diverges:
        //infinite, as SciPy gives it (the mean of a distribution bounded below, the variance of one bounded below or of
        //a finite mean: F, Pareto, inverse gamma, Student's t); the skewness and the kurtosis stay NaN
        if constexpr (!IsCauchy<D>::value) {
            const double largest = std::numeric_limits<double>::max();
            if (std::abs(mean) == largest) mean = std::copysign(INFINITE, mean);
            if (variance == largest) variance = INFINITE;
            if (std::isnan(mean) && std::isfinite(lower)) mean = INFINITE;
            if (std::isnan(variance) && (std::isfinite(mean) || std::isfinite(lower))) variance = INFINITE;
        }
        const double median = kind.discrete ? quantileAt(distribution, kind, 0.5) : boost::math::median(distribution);
        const double mode = boost::math::mode(distribution) + kind.shift;
        return std::vector<double>{kind.discrete ? 1.0 : 0.0, lower, upper, mean, variance, median, mode, skewness, kurtosis};
    });
}

std::vector<double> distributionAt(const std::string &name, const std::vector<double> &parameters, const std::string &function, const double *values, size_t size)
{
    check(name, parameters);
    return withDistribution<Policy>(name, parameters, [&](const auto &distribution, Kind kind) {
        std::vector<double> results(size);
        for (size_t i = 0; i < size; i++) {
            const double x = values[i];
            if (function == "pdf") results[i] = pdfAt(distribution, kind, x);
            else if (function == "cdf") results[i] = cdfAt(distribution, kind, x);
            else if (function == "survival") results[i] = survivalAt(distribution, kind, x);
            else if (function == "quantile") results[i] = quantileAt(distribution, kind, x);
            else if (function == "survivalQuantile") results[i] = survivalQuantileAt(distribution, kind, x);
            else throw MathError(ErrorCode::Argument, "Unknown function of a distribution: " + function);
        }
        return results;
    });
}

std::vector<double> sampleDistribution(const std::string &name, const std::vector<double> &parameters, size_t count, uint64_t state[4])
{
    check(name, parameters);
    return withDistribution<Policy>(name, parameters, [&](const auto &distribution, Kind kind) {
        std::vector<double> samples(count);
        for (size_t i = 0; i < count; i++) samples[i] = quantileAt(distribution, kind, uniformOf(state));
        return samples;
    });
}

void seedGenerator(uint64_t seed, uint64_t state[4])
{
    //splitmix64 (Vigna), as the authors of xoshiro advise
    for (int i = 0; i < 4; i++) {
        seed += 0x9e3779b97f4a7c15ULL;
        uint64_t z = seed;
        z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
        z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
        state[i] = z ^ (z >> 31);
    }
}

std::vector<double> uniformNumbers(size_t count, uint64_t state[4])
{
    std::vector<double> numbers(count);
    for (size_t i = 0; i < count; i++) numbers[i] = uniformOf(state);
    return numbers;
}

std::vector<double> uniformIntegers(size_t count, double lower, double upper, uint64_t state[4])
{
    const double limit = 9007199254740992.0;
    if (lower != std::floor(lower) || upper != std::floor(upper) || std::abs(lower) > limit || std::abs(upper) > limit) {
        throw MathError(ErrorCode::Argument, "The bounds of random integers are safe integers");
    }
    if (!(upper > lower)) throw MathError(ErrorCode::Argument, "The upper bound of random integers is above the lower one");
    //Of [0, range): the multiples of range below 2^64 kept, the others drawn again
    const uint64_t range = static_cast<uint64_t>(upper - lower);
    const uint64_t threshold = (0 - range) % range;
    std::vector<double> integers(count);
    for (size_t i = 0; i < count; i++) {
        uint64_t x = nextOf(state);
        while (x < threshold) x = nextOf(state);
        integers[i] = lower + static_cast<double>(x % range);
    }
    return integers;
}

}
