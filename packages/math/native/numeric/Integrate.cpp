//The integrals of a function of a variable: by QUADPACK's QAGS (as SciPy's quad), the Gauss-Kronrod rule of 21 points
//on intervals halved where the error is largest and the sequence of the results extrapolated by Wynn's epsilon
//algorithm near a singularity, a half line or the real line mapped onto a finite interval; unless that reaches the
//roundings, by a double-exponential quadrature too (tanh-sinh, exp-sinh, sinh-sinh), the more accurate result kept.
//Next to a finite end that is not 0, the double-exponential quadratures evaluate the integrand rewritten in terms of
//its distance u from it (x = a + u, expanded), where x itself would lose u in its roundings. A piece is split where
//the integrand is infinite at a point inside.
#include "Numeric.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <queue>

#include <boost_math_policy.h>

#include <boost/math/quadrature/exp_sinh.hpp>
#include <boost/math/quadrature/gauss.hpp>
#include <boost/math/quadrature/gauss_kronrod.hpp>
#include <boost/math/quadrature/sinh_sinh.hpp>
#include <boost/math/quadrature/tanh_sinh.hpp>

#include <symengine/add.h>
#include <symengine/mul.h>
#include <symengine/pow.h>
#include <symengine/symbol.h>
#include <symengine/visitor.h>

#include "Compiled.h"
#include "../async/Pool.h"
#include "../core/Errors.h"
#include "../ops/Operations.h"
#include "../ops/Piecewise.h"
#include "../poly/Rational.h"

namespace math {

namespace {

using SymEngine::Basic;
using SymEngine::down_cast;
using SymEngine::is_a;
using SymEngine::RCP;
using Policy = lakutata::BoostPolicy;
using Kronrod = boost::math::quadrature::gauss_kronrod<double, 21, Policy>;
using Gauss = boost::math::quadrature::gauss<double, 10, Policy>;

constexpr double INFINITE = std::numeric_limits<double>::infinity();
//The intervals of the subdivision at most: 21 values each (SciPy's quad has 50 by default)
constexpr size_t MAX_INTERVALS = 1000;
//An error estimate at the roundings of the integral of |f|
constexpr double ROUNDINGS = 1e-13;
//The splits of a piece at most, at the points inside where the integrand is infinite
constexpr int MAX_SPLITS = 8;
//The integer powers of sums expanded at most, next to an end
constexpr long LARGEST_EXPANDED_POWER = 64;

//The double-exponential quadratures: their tables of abscissas grow as they are needed, under their own locks. Made
//once and never destroyed: the threads of the pool may still use them while the process exits.
const boost::math::quadrature::tanh_sinh<double, Policy> &tanhSinh()
{
    static const auto *integrator = new boost::math::quadrature::tanh_sinh<double, Policy>();
    return *integrator;
}

const boost::math::quadrature::exp_sinh<double, Policy> &expSinh()
{
    static const auto *integrator = new boost::math::quadrature::exp_sinh<double, Policy>();
    return *integrator;
}

const boost::math::quadrature::sinh_sinh<double, Policy> &sinhSinh()
{
    static const auto *integrator = new boost::math::quadrature::sinh_sinh<double, Policy>();
    return *integrator;
}

//An expression expanded, also in the arguments of its functions (SymEngine's expand leaves them): ln(1 - (1 - u)^2) is
//ln(-u^2 + 2u)
class DeepExpansion : public SymEngine::TransformVisitor {
public:
    using TransformVisitor::bvisit;

    RCP<const Basic> apply(const RCP<const Basic> &x) override
    {
        const RCP<const Basic> rebuilt = TransformVisitor::apply(x);
        return is_a<SymEngine::Add>(*rebuilt) || is_a<SymEngine::Mul>(*rebuilt) || is_a<SymEngine::Pow>(*rebuilt) ? SymEngine::expand(rebuilt) : rebuilt;
    }
};

//Whether an expression has an integer power of a sum above LARGEST_EXPANDED_POWER (its expansion has too many terms)
bool hasLargePower(const Basic &e)
{
    if (is_a<SymEngine::Pow>(e)) {
        const auto &power = down_cast<const SymEngine::Pow &>(e);
        if (is_a<SymEngine::Add>(*power.get_base()) && is_a<SymEngine::Integer>(*power.get_exp())) {
            const auto &exponent = down_cast<const SymEngine::Integer &>(*power.get_exp());
            if (!exponent.is_zero() && (exponent.compare(*SymEngine::integer(LARGEST_EXPANDED_POWER)) > 0 || exponent.compare(*SymEngine::integer(-LARGEST_EXPANDED_POWER)) < 0)) return true;
        }
    }
    for (const auto &argument : e.get_args()) {
        if (hasLargePower(*argument)) return true;
    }
    return false;
}

//The integrand compiled, on a piece of the interval: the points where it is not finite are kept. The
//double-exponential quadratures leave out the values that are not finite next to an end (a singularity there, or an
//overflow: exp(-1/x)/x^2 is 0/0 below 10^-162), so a value that is not real counts only farther inside.
class Integrand {
public:
    Integrand(const Expr &function, const std::string &variable) : function(function), variable(variable), compiled({variable}, {function})
    {
    }

    void piece(double a, double b)
    {
        low = a;
        high = b;
        scale = std::isfinite(a) && std::isfinite(b) ? b - a : std::max({1.0, std::isfinite(a) ? std::abs(a) : 0.0, std::isfinite(b) ? std::abs(b) : 0.0});
        fromLowEnd.reset();
        fromHighEnd.reset();
        infiniteInside.reset();
    }

    double operator()(double x)
    {
        double y = 0;
        compiled.call(&y, &x);
        const double distance = std::min(std::isfinite(low) ? x - low : INFINITE, std::isfinite(high) ? high - x : INFINITE);
        return kept(x, distance, y);
    }

    //At a distance u >= 0 from the start of the piece, rewritten there where it is not 0
    double fromLow(double u)
    {
        if (low == 0) return (*this)(u);
        if (!fromLowEnd) fromLowEnd.emplace(std::vector<std::string>{variable}, std::vector<Expr>{rewritten(low, 1)});
        double y = 0;
        fromLowEnd->call(&y, &u);
        return kept(low + u, u, y);
    }

    //At a distance u >= 0 from the end of the piece
    double fromHigh(double u)
    {
        if (high == 0) return (*this)(-u);
        if (!fromHighEnd) fromHighEnd.emplace(std::vector<std::string>{variable}, std::vector<Expr>{rewritten(high, -1)});
        double y = 0;
        fromHighEnd->call(&y, &u);
        return kept(high - u, u, y);
    }

    //A point inside the piece where the integrand is not real, the first one met
    std::optional<double> notReal;
    //A point where it is infinite, the first one met; inside the piece, the first one met there
    std::optional<double> infinite, infiniteInside;

private:
    //The integrand of x = end + sign u, expanded unless that has too many terms; the end exactly the decimal it prints
    //as (0.3 is 3/10, as in the formula of the integrand)
    Expr rewritten(double end, int sign) const
    {
        const Expr u = SymEngine::symbol(variable);
        const Expr at = substitute(function, {{variable, SymEngine::add(numberFromDouble(end), sign > 0 ? u : SymEngine::neg(u))}});
        if (hasLargePower(*at)) return at;
        DeepExpansion expansion;
        return expansion.apply(at);
    }

    //A value that is not finite kept: not real, unless within the roundings of a finite end or toward an infinite one
    double kept(double x, double distance, double y)
    {
        if (++calls % 64 == 0) checkpoint();
        if (std::isfinite(y)) return y;
        const bool atEnd = distance <= 1e-12 * scale || (!std::isfinite(low) && x <= -1e100) || (!std::isfinite(high) && x >= 1e100);
        if (std::isnan(y)) {
            if (!atEnd && !notReal) notReal = x;
        } else {
            if (!infinite) infinite = x;
            if (!atEnd && !infiniteInside) infiniteInside = x;
        }
        return y;
    }

    Expr function;
    std::string variable;
    CompiledFunction compiled;
    std::optional<CompiledFunction> fromLowEnd, fromHighEnd;
    size_t calls = 0;
    double low = 0, high = 0, scale = 1;
};

struct Estimate {
    double value = 0;
    double error = INFINITE;
    double L1 = 0;
};

//The Gauss-Kronrod rule of 21 points on [a, b] (QUADPACK's QK21): its integral, its error (the difference from the
//Gauss rule of 10 points, scaled as QUADPACK scales it), the integrals of |f| and of |f - its mean|
struct Rule {
    double value, error, absolute, deviation;
};

template <typename F>
Rule kronrod(F &f, double a, double b)
{
    constexpr double EPSILON = std::numeric_limits<double>::epsilon(), SMALLEST = std::numeric_limits<double>::min();
    const double middle = a + (b - a) / 2, half = (b - a) / 2, width = std::abs(half);
    const auto &abscissas = Kronrod::abscissa();
    const auto &weights = Kronrod::weights();
    const auto &gaussWeights = Gauss::weights();
    double values[2][11];
    //Gauss's 10 points are the odd ones of Kronrod's 21 (0 is Kronrod's only)
    const double center = f(middle);
    double kronrodSum = center * weights[0], gaussSum = 0, absolute = std::abs(center) * weights[0];
    for (size_t i = 1; i < abscissas.size(); i++) {
        const double offset = half * abscissas[i], left = f(middle - offset), right = f(middle + offset);
        values[0][i] = left;
        values[1][i] = right;
        kronrodSum += (left + right) * weights[i];
        absolute += (std::abs(left) + std::abs(right)) * weights[i];
        if (i % 2 == 1) gaussSum += (left + right) * gaussWeights[i / 2];
    }
    const double mean = kronrodSum / 2;
    double deviation = weights[0] * std::abs(center - mean);
    for (size_t i = 1; i < abscissas.size(); i++) deviation += weights[i] * (std::abs(values[0][i] - mean) + std::abs(values[1][i] - mean));
    Rule rule{kronrodSum * half, std::abs((kronrodSum - gaussSum) * half), absolute * width, deviation * width};
    if (rule.deviation != 0 && rule.error != 0) rule.error = rule.deviation * std::min(1.0, std::pow(200 * rule.error / rule.deviation, 1.5));
    if (rule.absolute > SMALLEST / (50 * EPSILON)) rule.error = std::max(50 * EPSILON * rule.absolute, rule.error);
    return rule;
}

//Wynn's epsilon algorithm on the sequence of the integrals (QUADPACK's QELG): the limit of the sequence extrapolated,
//with an estimate of its error from the last three results
class Extrapolation {
public:
    void add(double value)
    {
        table[count++] = value;
    }

    size_t size() const
    {
        return count;
    }

    //The extrapolated value and its error
    std::pair<double, double> extrapolate()
    {
        constexpr double EPSILON = std::numeric_limits<double>::epsilon(), LARGEST = std::numeric_limits<double>::max();
        results++;
        double error = LARGEST, result = table[count - 1];
        if (count < 3) return {result, std::max(error, 5 * EPSILON * std::abs(result))};
        const size_t newElements = (count - 1) / 2, given = count;
        table[count + 1] = table[count - 1];
        table[count - 1] = LARGEST;
        size_t k1 = count - 1;
        for (size_t i = 1; i <= newElements; i++) {
            const size_t k2 = k1 - 1, k3 = k1 - 2;
            double value = table[k1 + 2];
            const double e0 = table[k3], e1 = table[k2], e2 = value;
            const double delta2 = e2 - e1, error2 = std::abs(delta2), tolerance2 = std::max(std::abs(e2), std::abs(e1)) * EPSILON;
            const double delta3 = e1 - e0, error3 = std::abs(delta3), tolerance3 = std::max(std::abs(e1), std::abs(e0)) * EPSILON;
            if (error2 <= tolerance2 && error3 <= tolerance3) {
                //e0, e1 and e2 equal to the roundings: converged
                result = value;
                error = error2 + error3;
                return {result, std::max(error, 5 * EPSILON * std::abs(result))};
            }
            const double e3 = table[k1];
            table[k1] = e1;
            const double delta1 = e1 - e3, error1 = std::abs(delta1), tolerance1 = std::max(std::abs(e1), std::abs(e3)) * EPSILON;
            double inverse = 0;
            //Two elements too close, or an irregular table: the table cut there
            if (error1 <= tolerance1 || error2 <= tolerance2 || error3 <= tolerance3 || std::abs((inverse = 1 / delta1 + 1 / delta2 - 1 / delta3) * e1) <= 1e-4) {
                count = i + i - 1;
                break;
            }
            value = e1 + 1 / inverse;
            table[k1] = value;
            k1 -= 2;
            const double estimate = error2 + std::abs(value - e2) + error3;
            if (estimate <= error) {
                error = estimate;
                result = value;
            }
        }
        //The table shifted
        if (count == LIMIT) count = 2 * (LIMIT / 2) - 1;
        size_t ib = given % 2 == 0 ? 1 : 0;
        for (size_t i = 0; i <= newElements; i++, ib += 2) table[ib] = table[ib + 2];
        if (given != count) {
            size_t index = given - count;
            for (size_t i = 0; i < count; i++) table[i] = table[index++];
        }
        if (results < 4) {
            last[results - 1] = result;
            error = LARGEST;
        } else {
            error = std::abs(result - last[2]) + std::abs(result - last[1]) + std::abs(result - last[0]);
            last[0] = last[1];
            last[1] = last[2];
            last[2] = result;
        }
        return {result, std::max(error, 5 * EPSILON * std::abs(result))};
    }

private:
    static constexpr size_t LIMIT = 50;
    double table[LIMIT + 2] = {};
    size_t count = 0;
    double last[3] = {};
    size_t results = 0;
};

//The adaptive integration of QUADPACK's QAGS on a finite interval: the interval of the largest error halved, and
//where the smallest intervals keep the largest errors (a singularity, inside or at an end), the sequence of the
//integrals extrapolated by Wynn's epsilon algorithm; until the error is within the tolerance times the integral of
//|f|, or MAX_INTERVALS
template <typename F>
Estimate adaptive(F &f, double a, double b, double tolerance)
{
    constexpr double EPSILON = std::numeric_limits<double>::epsilon(), SMALLEST = std::numeric_limits<double>::min(), LARGEST = std::numeric_limits<double>::max();
    struct Piece {
        double a, b, value, error, absolute;
    };
    std::vector<Piece> pieces;
    const Rule first = kronrod(f, a, b);
    pieces.push_back({a, b, first.value, first.error, first.absolute});
    double absoluteSum = first.absolute;
    const auto bound = [&](double value) { return tolerance * std::max(std::abs(value), absoluteSum); };
    Estimate estimate{first.value, first.error, first.absolute};
    if (!std::isfinite(first.value) || !std::isfinite(first.error)) return estimate;
    int failure = 0;
    if (first.error <= 100 * EPSILON * first.absolute && first.error > bound(first.value)) failure = 2;
    if (failure != 0 || (first.error <= bound(first.value) && first.error != first.deviation) || first.error == 0) return estimate;
    Extrapolation extrapolation;
    extrapolation.add(first.value);
    double errorMax = first.error, area = first.value, errorSum = first.error, result = first.value, error = LARGEST;
    double correction = 0, small = 0, errorLarge = 0, errorTest = 0;
    size_t maxError = 0, nrMax = 0, timesWithoutGain = 0;
    bool extrapolating = false, noExtrapolation = false;
    int roundOff1 = 0, roundOff2 = 0, roundOff3 = 0, roundOffError = 0;
    const int sign = std::abs(first.value) >= (1 - 50 * EPSILON) * first.absolute ? 1 : -1;
    std::vector<size_t> order{0};
    //The intervals by their errors, decreasing (QUADPACK keeps this order in QPSRT, moving nrmax back when a new half
    //climbs above the interval it points to; sorted again here, nrMax stays: it may halve another interval of the
    //smallest ones next, which the fixtures show does not change the results)
    const auto sortOrder = [&]() {
        order.resize(pieces.size());
        for (size_t i = 0; i < order.size(); i++) order[i] = i;
        std::stable_sort(order.begin(), order.end(), [&](size_t x, size_t y) { return pieces[x].error > pieces[y].error; });
    };
    bool summed = false;
    for (size_t last = 2; last <= MAX_INTERVALS; last++) {
        //The interval of the largest error, halved
        Piece &worst = pieces[maxError];
        const double a1 = worst.a, b1 = worst.a + (worst.b - worst.a) / 2, a2 = b1, b2 = worst.b;
        const double errorLast = errorMax;
        const Rule left = kronrod(f, a1, b1), right = kronrod(f, a2, b2);
        const double area12 = left.value + right.value, error12 = left.error + right.error;
        if (!std::isfinite(area12) || !std::isfinite(error12)) return {area12, INFINITE, absoluteSum};
        errorSum += error12 - errorMax;
        area += area12 - worst.value;
        absoluteSum += left.absolute + right.absolute - worst.absolute;
        if (left.deviation != left.error && right.deviation != right.error) {
            if (std::abs(worst.value - area12) <= 1e-5 * std::abs(area12) && error12 >= 0.99 * errorMax) (extrapolating ? roundOff2 : roundOff1)++;
            if (last > 10 && error12 > errorMax) roundOff3++;
        }
        const double errorBound = bound(area);
        if (roundOff1 + roundOff2 >= 10 || roundOff3 >= 20) failure = 2;
        if (roundOff2 >= 5) roundOffError = 3;
        if (last == MAX_INTERVALS) failure = 1;
        if (std::max(std::abs(a1), std::abs(b2)) <= (1 + 100 * EPSILON) * (std::abs(a2) + 1000 * SMALLEST)) failure = 4;
        pieces[maxError] = {a1, b1, left.value, left.error, left.absolute};
        pieces.push_back({a2, b2, right.value, right.error, right.absolute});
        sortOrder();
        maxError = order[nrMax];
        errorMax = pieces[maxError].error;
        if (errorSum <= errorBound) {
            summed = true;
            break;
        }
        if (failure != 0) break;
        if (last == 2) {
            small = std::abs(b - a) * 0.375;
            errorLarge = errorSum;
            errorTest = errorBound;
            extrapolation.add(area);
            continue;
        }
        if (noExtrapolation) continue;
        errorLarge -= errorLast;
        if (std::abs(b1 - a1) > small) errorLarge += error12;
        if (!extrapolating) {
            //The interval to halve next is not the smallest one: no extrapolation yet
            if (std::abs(pieces[maxError].b - pieces[maxError].a) > small) continue;
            extrapolating = true;
            nrMax = 1;
        }
        bool halveLarge = false;
        if (roundOffError != 3 && errorLarge > errorTest) {
            //The smallest interval has the largest error: the larger intervals halved first, while their errors sum
            //above the tolerance
            const size_t upper = last > 2 + MAX_INTERVALS / 2 ? MAX_INTERVALS + 3 - last : last;
            for (size_t k = nrMax; k < upper && nrMax < order.size(); k++) {
                maxError = order[nrMax];
                errorMax = pieces[maxError].error;
                if (std::abs(pieces[maxError].b - pieces[maxError].a) > small) {
                    halveLarge = true;
                    break;
                }
                nrMax++;
            }
        }
        if (halveLarge) continue;
        //The extrapolation of the sequence of the integrals
        extrapolation.add(area);
        const auto [extrapolated, extrapolationError] = extrapolation.extrapolate();
        timesWithoutGain++;
        if (timesWithoutGain > 5 && error < 1e-3 * errorSum) failure = 5;
        if (extrapolationError < error) {
            timesWithoutGain = 0;
            error = extrapolationError;
            result = extrapolated;
            correction = errorLarge;
            errorTest = bound(extrapolated);
            if (error <= errorTest) break;
        }
        //The smallest interval halved next
        if (extrapolation.size() == 1) noExtrapolation = true;
        if (failure == 5) break;
        maxError = order[0];
        errorMax = pieces[maxError].error;
        nrMax = 0;
        extrapolating = false;
        small *= 0.5;
        errorLarge = errorSum;
    }
    //The result: the sum of the intervals, or the extrapolated one; after a failure, the one of the smaller relative
    //error
    bool useSum = summed || error == LARGEST, divergence = false;
    if (!useSum) {
        if (failure + roundOffError == 0) {
            divergence = true;
        } else {
            if (roundOffError == 3) error += correction;
            if (result != 0 && area != 0) {
                useSum = error / std::abs(result) > errorSum / std::abs(area);
                divergence = !useSum;
            } else {
                useSum = error > errorSum;
                divergence = !useSum && area != 0;
            }
        }
    }
    if (useSum) {
        result = 0;
        for (const Piece &piece : pieces) result += piece.value;
        error = errorSum;
    } else if (divergence && !(sign == -1 && std::max(std::abs(result), std::abs(area)) <= first.absolute * 0.01) && (0.01 > result / area || result / area > 100 || errorSum > std::abs(area))) {
        //Divergent, or converging too slowly: not converged
        error = std::max({error, std::abs(result), absoluteSum});
    }
    return {result, error, absoluteSum};
}

//The subdivision on a half line or the real line, mapped onto (-1, 1) as Boost's Gauss-Kronrod maps it: its points
//stay inside, so x does not grow beyond the decay of the integrand (x^3 e^-x is inf times 0 at 10^103)
template <typename F>
Estimate mapped(F &f, double a, double b, double tolerance)
{
    if (std::isfinite(a) && std::isfinite(b)) return adaptive(f, a, b, tolerance);
    Estimate estimate;
    if (!std::isfinite(a) && !std::isfinite(b)) {
        auto g = [&f](double t) {
            const double inverse = 1 / (1 - t * t);
            return f(t * inverse) * (1 + t * t) * inverse * inverse;
        };
        estimate = adaptive(g, -1, 1, tolerance);
    } else {
        //x = a + 2/(t + 1) - 1 from a to infinity, dx = -2 dt/(t + 1)^2; toward -infinity, x = b - (2/(t + 1) - 1)
        const bool right = std::isfinite(a);
        const double end = right ? a : b;
        auto g = [&f, right, end](double t) {
            const double z = 1 / (t + 1), offset = 2 * z - 1;
            return f(right ? end + offset : end - offset) * 2 * z * z;
        };
        estimate = adaptive(g, -1, 1, tolerance);
    }
    return estimate;
}

//The integral of a piece [a, b], a < b: the subdivision, then the double-exponential quadrature unless the error of the
//subdivision is already at its roundings; the result of the smaller error estimate. Near a singularity at an end, the
//subdivision converges slowly, its error about the tolerance (1/sqrt(x) on [0, 1] is 2 - 1.5e-8), while the
//double-exponential quadrature reaches the roundings. Where the integrand is infinite at a point inside (a point of the
//rules on a singularity: 1/sqrt(abs(x - 1/4)) at the middle of [0, 1/2]), the piece is split there, as by the points.
Estimate integratePiece(Integrand &integrand, double a, double b, double tolerance, int splits = 0)
{
    integrand.piece(a, b);
    auto f = [&integrand](double x) { return integrand(x); };
    Estimate best;
    double bestError = INFINITE;
    bool found = false;
    //Compared by the errors they likely have: a double-exponential quadrature that converges doubles its digits at each
    //level, so its error is about the square of its estimate (the difference from the level before), relative to the
    //integral of |f|
    const auto take = [&](const Estimate &estimate, bool doubleExponential) {
        if (!std::isfinite(estimate.value) || !std::isfinite(estimate.error)) return;
        double likely = estimate.error;
        if (doubleExponential && estimate.error <= tolerance * estimate.L1 && estimate.L1 > 0) {
            likely = std::max(estimate.error * estimate.error / estimate.L1, std::numeric_limits<double>::epsilon() * estimate.L1);
        }
        if (!found || likely < bestError) {
            best = estimate;
            bestError = likely;
        }
        found = true;
    };
    take(mapped(f, a, b, tolerance), false);
    if (found && best.error <= std::min(tolerance, ROUNDINGS) * best.L1) return best;
    //Next to a finite end, the integrand at the distance from it: the quadratures give it exactly (tanh-sinh as the
    //second argument, negative from a; exp-sinh integrates over the distance)
    Estimate exponential;
    if (std::isfinite(a) && std::isfinite(b)) {
        const double near = (b - a) / 1024;
        auto g = [&integrand, near](double x, double distance) {
            if (distance < 0 && -distance <= near) return integrand.fromLow(-distance);
            if (distance > 0 && distance <= near) return integrand.fromHigh(distance);
            return integrand(x);
        };
        exponential.value = tanhSinh().integrate(g, a, b, tolerance, &exponential.error, &exponential.L1);
    } else if (std::isfinite(a) || std::isfinite(b)) {
        const bool right = std::isfinite(a);
        const double end = right ? a : b, near = std::max(1.0, std::abs(end)) / 1024;
        auto g = [&integrand, right, end, near](double t) {
            if (t <= near) return right ? integrand.fromLow(t) : integrand.fromHigh(t);
            return integrand(right ? end + t : end - t);
        };
        exponential.value = expSinh().integrate(g, 0.0, INFINITE, tolerance, &exponential.error, &exponential.L1);
    } else {
        exponential.value = sinhSinh().integrate(f, tolerance, &exponential.error, &exponential.L1);
    }
    take(exponential, true);
    if (integrand.notReal) throw MathError(ErrorCode::Domain, "The integrand is not real at " + shortest(*integrand.notReal));
    if (integrand.infiniteInside && splits < MAX_SPLITS && !(found && best.error <= tolerance * best.L1)) {
        const double at = *integrand.infiniteInside;
        const Estimate left = integratePiece(integrand, a, at, tolerance, splits + 1), right = integratePiece(integrand, at, b, tolerance, splits + 1);
        return {left.value + right.value, left.error + right.error, left.L1 + right.L1};
    }
    if (!found) {
        if (integrand.infinite) throw MathError(ErrorCode::Domain, "The integrand is infinite at " + shortest(*integrand.infinite));
        throw MathError(ErrorCode::Domain, "The integral has no finite value on [" + shortest(a) + ", " + shortest(b) + "]");
    }
    return best;
}

//The real poles inside (low, high): the roots of the factors of the denominator that are polynomials in the variable
//(of degree 100 at most), where the numerator is not 0 (the singularity of sin(x)/x at 0 is removable). The pieces are
//split there: each one diverges at its end, as 1/x on [0, 1], where the subdivision would otherwise cancel the two sides
//(the principal value of 1/x on [-1, 2] taken for its integral)
std::vector<double> polesInside(const Expr &function, const std::string &variable, double low, double high)
{
    std::vector<double> poles;
    const std::pair<Expr, Expr> fraction = fractionOf(function);
    std::vector<Expr> factors;
    if (is_a<SymEngine::Mul>(*fraction.second)) {
        for (const auto &entry : down_cast<const SymEngine::Mul &>(*fraction.second).get_dict()) factors.push_back(entry.first);
    } else if (is_a<SymEngine::Pow>(*fraction.second)) {
        factors.push_back(down_cast<const SymEngine::Pow &>(*fraction.second).get_base());
    } else {
        factors.push_back(fraction.second);
    }
    CompiledFunction numerator({variable}, {fraction.first});
    const auto at = [&numerator](double x) {
        double y = 0;
        numerator.call(&y, &x);
        return std::abs(y);
    };
    for (const Expr &factor : factors) {
        ComplexRoots roots;
        try {
            if (coefficientsOf(factor, variable).size() > 101) continue;
            roots = polynomialRootsOf(factor, variable);
        } catch (const MathError &) {
            continue;
        }
        for (size_t i = 0; i < roots.re.size(); i++) {
            const double root = roots.re[i];
            if (!(std::abs(roots.im[i]) <= 1e-9 * std::max(1.0, std::abs(root)) && root > low && root < high)) continue;
            const double near = (std::isfinite(high - low) ? high - low : 1.0) / 1000;
            const double value = at(root), around = std::max(at(root - near), at(root + near));
            if (!(value <= 1e-8 * around)) poles.push_back(root);
        }
    }
    return poles;
}

}

IntegralResult integralOf(const Expr &given, const std::string &variable, double a, double b, const std::vector<double> &points, double tolerance)
{
    if (!(tolerance >= 0 && tolerance < 1)) throw MathError(ErrorCode::Argument, "The tolerance is a number from 0 to 1, 1 excluded");
    if (std::isnan(a) || std::isnan(b)) throw MathError(ErrorCode::Argument, "The ends of the interval are numbers");
    IntegralResult result;
    //A fraction of polynomials with a common factor cancelled ((x^2 - 1)/(x - 1) is x + 1, not 0/0 at 1)
    Expr function = given;
    try {
        if (has_symbol(*fractionOf(given).second, *SymEngine::symbol(variable))) cancelled(given, function);
    } catch (const MathError &error) {
        if (error.code() != ErrorCode::NotSupported) throw;
    }
    Integrand integrand(function, variable);
    if (a == b) {
        result.converged = true;
        return result;
    }
    const double sign = a < b ? 1 : -1, low = std::min(a, b), high = std::max(a, b);
    //The pieces between the points
    std::vector<double> ends{low};
    std::vector<double> inside;
    for (const double point : points) {
        if (!(point >= low && point <= high)) throw MathError(ErrorCode::Argument, "The points are in the interval: " + shortest(point) + " is not");
        if (point > low && point < high) inside.push_back(point);
    }
    const std::vector<double> poles = polesInside(function, variable, low, high);
    inside.insert(inside.end(), poles.begin(), poles.end());
    //The points where a piecewise part changes its case (step(x - 1) at 1)
    for (const double point : breakpointsOf(function, variable)) {
        if (point > low && point < high) inside.push_back(point);
    }
    std::sort(inside.begin(), inside.end());
    inside.erase(std::unique(inside.begin(), inside.end()), inside.end());
    ends.insert(ends.end(), inside.begin(), inside.end());
    ends.push_back(high);
    double L1 = 0;
    for (size_t i = 0; i + 1 < ends.size(); i++) {
        const Estimate piece = integratePiece(integrand, ends[i], ends[i + 1], tolerance);
        result.value += piece.value;
        result.error += piece.error;
        L1 += piece.L1;
    }
    result.value *= sign;
    result.converged = result.error <= tolerance * L1;
    return result;
}

}
