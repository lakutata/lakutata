//The statistics of vectors of doubles: compensated sums (Neumaier's), variances and covariances by the corrected
//two-pass algorithm, medians by selection, quantiles by the linear interpolation of NumPy (its formula, for the same
//roundings), modes by sorting.
#include "Statistics.h"

#include <algorithm>
#include <cmath>
#include <limits>

#include "../core/Errors.h"

namespace math {

namespace {

constexpr double NOT_A_NUMBER = std::numeric_limits<double>::quiet_NaN();

//A sum compensated for its roundings (Neumaier's); the plain sum where it is not finite (an infinity among the terms,
//or an overflow), which the compensation would turn into NaN
struct Accumulator {
    double sum = 0;
    double compensation = 0;
    double plain = 0;

    void add(double value)
    {
        const double next = sum + value;
        compensation += std::abs(sum) >= std::abs(value) ? (sum - next) + value : (value - next) + sum;
        sum = next;
        plain += value;
    }

    double value() const
    {
        return std::isfinite(plain) ? sum + compensation : plain;
    }
};

double sumOf(const double *values, size_t size)
{
    Accumulator accumulator;
    for (size_t i = 0; i < size; i++) accumulator.add(values[i]);
    return accumulator.value();
}

bool hasNaN(const double *values, size_t size)
{
    for (size_t i = 0; i < size; i++) {
        if (std::isnan(values[i])) return true;
    }
    return false;
}

void requireValues(const VectorArgument &vector)
{
    if (vector.size == 0) throw MathError(ErrorCode::Argument, "The values are empty");
}

void requireSameSize(const VectorArgument &x, const VectorArgument &y)
{
    if (x.size != y.size) throw MathError(ErrorCode::Argument, "The two vectors differ in length: " + std::to_string(x.size) + " and " + std::to_string(y.size));
}

//The divisor of a sum of squared deviations: n (uncorrected, 0), n - 1 (unbiased, 1), n + 1 (biased, 2)
double divisorOf(size_t size, const std::vector<double> &numbers)
{
    const double normalization = numbers.empty() ? 0 : numbers[0];
    if (normalization == 0) return static_cast<double>(size);
    if (normalization == 1) return static_cast<double>(size) - 1;
    if (normalization == 2) return static_cast<double>(size) + 1;
    throw MathError(ErrorCode::Argument, "The normalization is 'uncorrected', 'unbiased' or 'biased'");
}

double meanOf(const double *values, size_t size)
{
    return sumOf(values, size) / static_cast<double>(size);
}

//The sums of the products of the deviations from the means, corrected by the sums of the deviations (which are 0 but
//for the roundings of the means)
double deviationsOf(const double *x, const double *y, size_t size)
{
    const double mx = meanOf(x, size), my = meanOf(y, size);
    Accumulator products, dx, dy;
    for (size_t i = 0; i < size; i++) {
        products.add((x[i] - mx) * (y[i] - my));
        dx.add(x[i] - mx);
        dy.add(y[i] - my);
    }
    return products.value() - dx.value() * dy.value() / static_cast<double>(size);
}

double varianceOf(const double *values, size_t size, const std::vector<double> &numbers)
{
    return deviationsOf(values, values, size) / divisorOf(size, numbers);
}

//The middle of two values, as their mean, without overflowing
double middleOf(double a, double b)
{
    const double sum = a + b;
    return std::isfinite(sum) || !std::isfinite(a) || !std::isfinite(b) ? sum / 2 : a / 2 + b / 2;
}

double medianOf(std::vector<double> values)
{
    const size_t k = values.size() / 2;
    std::nth_element(values.begin(), values.begin() + static_cast<std::ptrdiff_t>(k), values.end());
    if (values.size() % 2 == 1) return values[k];
    const double below = *std::max_element(values.begin(), values.begin() + static_cast<std::ptrdiff_t>(k));
    return middleOf(below, values[k]);
}

//The quantile of p of sorted values: NumPy's linear interpolation between the values of the indices around (n - 1) p,
//by its formula (from the nearer one)
double quantileOf(const std::vector<double> &sorted, double p)
{
    const double index = (static_cast<double>(sorted.size()) - 1) * p;
    const double below = std::floor(index);
    const size_t lower = static_cast<size_t>(below), upper = std::min(lower + 1, sorted.size() - 1);
    const double t = index - below, a = sorted[lower], b = sorted[upper];
    const double difference = b - a;
    return t >= 0.5 ? b - difference * (1 - t) : a + difference * t;
}

std::vector<double> copyOf(const VectorArgument &vector)
{
    return std::vector<double>(vector.values, vector.values + vector.size);
}

void requireCount(const std::vector<VectorArgument> &vectors, size_t count, const std::string &operation)
{
    if (vectors.size() != count) throw MathError(ErrorCode::Argument, "The statistic " + operation + " takes " + std::to_string(count) + " vectors");
}

}

std::vector<std::vector<double>> statisticsOf(const std::string &operation, const std::vector<VectorArgument> &vectors, const std::vector<double> &numbers)
{
    const bool pair = operation == "cov" || operation == "corr" || operation == "kldivergence";
    requireCount(vectors, operation == "quantile" || pair ? 2 : 1, operation);
    const VectorArgument &x = vectors[0];
    const double *values = x.values;
    const size_t n = x.size;
    if (operation == "sum") return {{sumOf(values, n)}};
    if (operation == "prod") {
        double product = 1;
        for (size_t i = 0; i < n; i++) product *= values[i];
        return {{product}};
    }
    if (operation == "cumsum") {
        std::vector<double> sums(n);
        Accumulator accumulator;
        for (size_t i = 0; i < n; i++) {
            accumulator.add(values[i]);
            sums[i] = accumulator.value();
        }
        return {sums};
    }
    if (operation == "diff") {
        std::vector<double> differences(n > 0 ? n - 1 : 0);
        for (size_t i = 0; i + 1 < n; i++) differences[i] = values[i + 1] - values[i];
        return {differences};
    }
    if (operation == "zscore") {
        if (n == 0) return {std::vector<double>()};
        const double mean = meanOf(values, n), deviation = std::sqrt(varianceOf(values, n, numbers));
        std::vector<double> scores(n);
        for (size_t i = 0; i < n; i++) scores[i] = (values[i] - mean) / deviation;
        return {scores};
    }
    if (operation == "kldivergence") {
        //Of two distributions, each normalized to a sum of 1: Σ p log(p / q), a term of p = 0 being 0 and one of q = 0
        //(p > 0) infinite (SciPy's entropy)
        const VectorArgument &y = vectors[1];
        requireSameSize(x, y);
        requireValues(x);
        for (size_t i = 0; i < n; i++) {
            if (x.values[i] < 0 || y.values[i] < 0) throw MathError(ErrorCode::Argument, "A probability of a distribution is negative");
        }
        const double total = sumOf(x.values, n), otherTotal = sumOf(y.values, n);
        if (std::isnan(total) || std::isnan(otherTotal)) return {{NOT_A_NUMBER}};
        if (!(total > 0) || !(otherTotal > 0)) throw MathError(ErrorCode::Argument, "The probabilities of a distribution add up to 0");
        Accumulator divergence;
        for (size_t i = 0; i < n; i++) {
            const double p = x.values[i] / total, q = y.values[i] / otherTotal;
            if (std::isnan(p) || std::isnan(q)) return {{NOT_A_NUMBER}};
            if (p == 0) continue;
            divergence.add(q == 0 ? std::numeric_limits<double>::infinity() : p * std::log(p / q));
        }
        return {{divergence.value()}};
    }
    requireValues(x);
    if (operation == "mean") return {{meanOf(values, n)}};
    if (operation == "min" || operation == "max") {
        if (hasNaN(values, n)) return {{NOT_A_NUMBER}};
        return {{operation == "min" ? *std::min_element(values, values + n) : *std::max_element(values, values + n)}};
    }
    if (operation == "variance") return {{varianceOf(values, n, numbers)}};
    if (operation == "std") return {{std::sqrt(varianceOf(values, n, numbers))}};
    if (operation == "cov" || operation == "corr") {
        const VectorArgument &y = vectors[1];
        requireSameSize(x, y);
        if (operation == "cov") return {{deviationsOf(x.values, y.values, n) / divisorOf(n, numbers)}};
        //Pearson's: the normalizations cancel; within [-1, 1] despite the roundings
        const double xy = deviationsOf(x.values, y.values, n), xx = deviationsOf(x.values, x.values, n), yy = deviationsOf(y.values, y.values, n);
        const double r = xy / std::sqrt(xx * yy);
        return {{std::isnan(r) ? r : std::max(-1.0, std::min(1.0, r))}};
    }
    //The statistics of the order of the values: NaN where one of them is NaN (it has no place in it)
    if (hasNaN(values, n)) {
        if (operation == "quantile") return {std::vector<double>(vectors[1].size, NOT_A_NUMBER)};
        return {{NOT_A_NUMBER}};
    }
    if (operation == "median") return {{medianOf(copyOf(x))}};
    if (operation == "mad") {
        //The median absolute deviation, from the median
        const double median = medianOf(copyOf(x));
        std::vector<double> deviations(n);
        for (size_t i = 0; i < n; i++) deviations[i] = std::abs(values[i] - median);
        return {{medianOf(std::move(deviations))}};
    }
    if (operation == "quantile") {
        const VectorArgument &probabilities = vectors[1];
        for (size_t i = 0; i < probabilities.size; i++) {
            if (!(probabilities.values[i] >= 0 && probabilities.values[i] <= 1)) throw MathError(ErrorCode::Argument, "A probability of a quantile is from 0 to 1");
        }
        std::vector<double> sorted = copyOf(x);
        std::sort(sorted.begin(), sorted.end());
        std::vector<double> quantiles(probabilities.size);
        for (size_t i = 0; i < probabilities.size; i++) quantiles[i] = quantileOf(sorted, probabilities.values[i]);
        return {quantiles};
    }
    if (operation == "mode") {
        //The values of the most occurrences, ascending
        std::vector<double> sorted = copyOf(x);
        std::sort(sorted.begin(), sorted.end());
        std::vector<double> modes;
        size_t most = 0;
        for (size_t start = 0; start < n;) {
            size_t end = start;
            while (end < n && sorted[end] == sorted[start]) end++;
            if (end - start > most) {
                most = end - start;
                modes.clear();
            }
            if (end - start == most) modes.push_back(sorted[start]);
            start = end;
        }
        return {modes};
    }
    throw MathError(ErrorCode::Argument, "Unknown statistic: " + operation);
}

}
