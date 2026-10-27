//The statistics of vectors of doubles (math.stats): sums, means, medians, modes, variances, quantiles, covariances,
//correlations, z-scores, divergences
#pragma once

#include <cstddef>
#include <memory>
#include <string>
#include <vector>

namespace math {

//A vector of doubles: the elements of a Float64Array, borrowed by a synchronous operation or copied for an
//asynchronous one
struct VectorArgument {
    size_t size = 0;
    const double *values = nullptr;
    std::shared_ptr<const std::vector<double>> owned;
};

//An operation of the statistics on vectors, with its options (numbers): its results, each a vector (a number is a
//vector of one element). Values that are empty where the statistic has none, vectors of different lengths and options
//outside their range throw MathError (Argument); a NaN among the values gives NaN.
std::vector<std::vector<double>> statisticsOf(const std::string &operation, const std::vector<VectorArgument> &vectors, const std::vector<double> &numbers);

}
