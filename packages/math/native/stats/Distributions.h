//The probability distributions of math.stats, on Boost.Math, and the random numbers of their samples
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace math {

//The description of a distribution of parameters, which are checked first (MathError Argument where they are not
//valid): [discrete (0 or 1), the lower and the upper bounds of its support, its mean, variance, median, mode, skewness,
//excess kurtosis] (NaN where a moment does not exist)
std::vector<double> describeDistribution(const std::string &name, const std::vector<double> &parameters);

//A function of a distribution at values: pdf (the probability mass of a discrete one), cdf, survival, quantile,
//survivalQuantile
std::vector<double> distributionAt(const std::string &name, const std::vector<double> &parameters, const std::string &function, const double *values, size_t size);

//Samples of a distribution, by inversion of uniform numbers of the generator of the state given (xoshiro256**),
//which they advance
std::vector<double> sampleDistribution(const std::string &name, const std::vector<double> &parameters, size_t count, uint64_t state[4]);

//The state of a generator of a seed (by splitmix64)
void seedGenerator(uint64_t seed, uint64_t state[4]);

//Uniform numbers of (0, 1) of a generator, which they advance
std::vector<double> uniformNumbers(size_t count, uint64_t state[4]);

//Integers of [lower, upper) of a generator, uniform (without bias, by rejection), which they advance
std::vector<double> uniformIntegers(size_t count, double lower, double upper, uint64_t state[4]);

}
