//The helpers of the linear algebra (Linalg.cpp): the maps and copies of the matrices given, the
//results, the checks of their dimensions
#pragma once

#include <string>
#include <vector>

#include <Eigen/Core>

#include "Linalg.h"
#include "../core/Errors.h"

namespace math {

using RowMajorMatrix = Eigen::Matrix<double, Eigen::Dynamic, Eigen::Dynamic, Eigen::RowMajor>;
using MatrixMap = Eigen::Map<const RowMajorMatrix>;

inline MatrixMap mapOf(const MatrixArgument &matrix)
{
    return MatrixMap(matrix.values, static_cast<Eigen::Index>(matrix.rows), static_cast<Eigen::Index>(matrix.columns));
}

//A column-major copy, for the decompositions (nothing next to their cost, and one instantiation of each)
inline Eigen::MatrixXd copyOf(const MatrixArgument &matrix)
{
    return mapOf(matrix);
}

template <typename Derived>
MatrixResult resultOf(const Eigen::MatrixBase<Derived> &matrix)
{
    MatrixResult result;
    result.rows = static_cast<size_t>(matrix.rows());
    result.columns = static_cast<size_t>(matrix.cols());
    result.values.resize(result.rows * result.columns);
    Eigen::Map<RowMajorMatrix>(result.values.data(), matrix.rows(), matrix.cols()) = matrix;
    return result;
}

inline MatrixResult numberOf(double value)
{
    return {1, 1, {value}};
}

inline void requireSquare(const MatrixArgument &matrix, const char *what)
{
    if (matrix.rows != matrix.columns) {
        throw MathError(ErrorCode::Argument, std::string(what) + " is not square (" + std::to_string(matrix.rows) + "×" + std::to_string(matrix.columns) + ")");
    }
}

inline void requireRows(const MatrixArgument &matrix, size_t rows, const char *what)
{
    if (matrix.rows != rows) throw MathError(ErrorCode::Argument, std::string(what) + " has " + std::to_string(matrix.rows) + " rows, not " + std::to_string(rows));
}

inline void requireCount(const std::vector<MatrixArgument> &matrices, size_t count, const std::string &operation)
{
    if (matrices.size() != count) throw MathError(ErrorCode::Argument, "The operation " + operation + " takes " + std::to_string(count) + " matrices");
}

}
