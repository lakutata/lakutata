//The numeric linear algebra (math.linalg, Matrix): dense matrices of doubles on Eigen
#pragma once

#include <cstddef>
#include <memory>
#include <string>
#include <vector>

namespace math {

//A dense matrix of doubles, row-major: the elements of a Float64Array, borrowed by a synchronous operation, or their
//copy, owned by an asynchronous one
struct MatrixArgument {
    size_t rows = 0;
    size_t columns = 0;
    const double *values = nullptr;
    std::shared_ptr<const std::vector<double>> owned;
};

//A matrix of a result, row-major (a vector is a column, a number a matrix of one element)
struct MatrixResult {
    size_t rows = 0;
    size_t columns = 0;
    std::vector<double> values;
};

//An operation of the linear algebra on matrices, with its options (numbers, a text): its results, in the order of the
//operation. The dimensions are checked before Eigen sees them (its assertions are not errors); a singular matrix where
//an inverse is needed throws MathError (Domain), a matrix of the wrong dimensions MathError (Argument)
std::vector<MatrixResult> linalgOf(const std::string &operation, const std::vector<MatrixArgument> &matrices, const std::vector<double> &numbers, const std::string &option);

}
