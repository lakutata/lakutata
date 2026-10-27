//The numeric linear algebra (math.linalg, Matrix, SparseMatrix): dense and sparse matrices of doubles on Eigen
#pragma once

#include <cstddef>
#include <cstdint>
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

//A sparse matrix in compressed rows: the entries of row i are pointers[i] to pointers[i + 1] - 1, of the columns
//indices[k] and the values values[k]; borrowed by a synchronous operation or copied for an asynchronous one, as a
//matrix. Nothing about them is trusted before sparseOf() checks them.
struct SparseArgument {
    size_t rows = 0;
    size_t columns = 0;
    size_t entries = 0;
    const int32_t *pointers = nullptr;
    const int32_t *indices = nullptr;
    const double *values = nullptr;
    std::shared_ptr<const std::vector<int32_t>> ownedPointers;
    std::shared_ptr<const std::vector<int32_t>> ownedIndices;
    std::shared_ptr<const std::vector<double>> ownedValues;
};

//A sparse matrix of a result, in compressed rows of increasing columns
struct SparseResult {
    size_t rows = 0;
    size_t columns = 0;
    std::vector<int32_t> pointers;
    std::vector<int32_t> indices;
    std::vector<double> values;
};

//The results of an operation on sparse matrices: its dense matrices and its sparse ones, each in its order
struct SparseResults {
    std::vector<MatrixResult> dense;
    std::vector<SparseResult> sparse;
};

//An operation on sparse matrices (and dense ones, numbers): the structure of each sparse matrix is checked first (its
//pointers, its columns increasing in each row) and throws MathError (Argument) where it is not one
SparseResults sparseOf(const std::string &operation, const std::vector<SparseArgument> &sparse, const std::vector<MatrixArgument> &dense, const std::vector<double> &numbers);

}
