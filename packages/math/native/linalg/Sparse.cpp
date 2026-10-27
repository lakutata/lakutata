//The sparse matrices on Eigen, in compressed rows: their products, the solutions of their systems by the sparse LU
//decomposition (SparseLU, of a column-major copy ordered by COLAMD), by the conjugate gradient and by BiCGSTAB (both
//with the diagonal as preconditioner). Their structure comes from JavaScript, where it can be changed after it was
//checked there: it is checked again here, before Eigen reads it (its assertions are not errors).
#include "Linalg.h"
#include "LinalgSupport.h"

#include <algorithm>
#include <cmath>
#include <numeric>

#include <Eigen/IterativeLinearSolvers>
#include <Eigen/SparseCore>
#include <Eigen/SparseLU>

#include "../async/Pool.h"
#include "../core/Errors.h"

namespace math {

namespace {

using SparseRows = Eigen::SparseMatrix<double, Eigen::RowMajor, int>;
using SparseColumns = Eigen::SparseMatrix<double, Eigen::ColMajor, int>;

[[noreturn]] void invalid(const std::string &reason)
{
    throw MathError(ErrorCode::Argument, "The sparse matrix is not valid: " + reason);
}

//Its row pointers from 0 to the number of entries, never decreasing (all of them first: they bound what is read of the
//columns), and the columns of each row increasing and below the columns of the matrix
void check(const SparseArgument &matrix)
{
    if (matrix.pointers[0] != 0) invalid("its first row pointer is not 0");
    if (matrix.pointers[matrix.rows] < 0 || static_cast<size_t>(matrix.pointers[matrix.rows]) != matrix.entries) invalid("its last row pointer is not its number of entries");
    for (size_t i = 0; i < matrix.rows; i++) {
        if (matrix.pointers[i + 1] < matrix.pointers[i]) invalid("its row pointers decrease at row " + std::to_string(i));
    }
    for (size_t i = 0; i < matrix.rows; i++) {
        const int32_t start = matrix.pointers[i], end = matrix.pointers[i + 1];
        for (int32_t k = start; k < end; k++) {
            const int32_t column = matrix.indices[k];
            if (column < 0 || static_cast<size_t>(column) >= matrix.columns) invalid("an entry of row " + std::to_string(i) + " is in column " + std::to_string(column));
            if (k > start && column <= matrix.indices[k - 1]) invalid("the columns of row " + std::to_string(i) + " do not increase");
        }
    }
}

Eigen::Map<const SparseRows> mapOf(const SparseArgument &matrix)
{
    return Eigen::Map<const SparseRows>(static_cast<Eigen::Index>(matrix.rows), static_cast<Eigen::Index>(matrix.columns), static_cast<Eigen::Index>(matrix.entries), matrix.pointers, matrix.indices, matrix.values);
}

//A result in compressed rows, the columns of each row sorted (Eigen's products need not sort them)
SparseResult sparseResultOf(SparseRows matrix)
{
    matrix.makeCompressed();
    SparseResult result;
    result.rows = static_cast<size_t>(matrix.rows());
    result.columns = static_cast<size_t>(matrix.cols());
    const size_t entries = static_cast<size_t>(matrix.nonZeros());
    result.pointers.assign(matrix.outerIndexPtr(), matrix.outerIndexPtr() + matrix.rows() + 1);
    result.indices.assign(matrix.innerIndexPtr(), matrix.innerIndexPtr() + entries);
    result.values.assign(matrix.valuePtr(), matrix.valuePtr() + entries);
    std::vector<int32_t> order;
    for (size_t i = 0; i < result.rows; i++) {
        const int32_t start = result.pointers[i], end = result.pointers[i + 1];
        if (std::is_sorted(result.indices.begin() + start, result.indices.begin() + end)) continue;
        order.resize(static_cast<size_t>(end - start));
        std::iota(order.begin(), order.end(), start);
        std::sort(order.begin(), order.end(), [&result](int32_t x, int32_t y) { return result.indices[x] < result.indices[y]; });
        std::vector<int32_t> indices;
        std::vector<double> values;
        for (const int32_t k : order) {
            indices.push_back(result.indices[k]);
            values.push_back(result.values[k]);
        }
        std::copy(indices.begin(), indices.end(), result.indices.begin() + start);
        std::copy(values.begin(), values.end(), result.values.begin() + start);
    }
    return result;
}

void requireSquareSparse(const SparseArgument &matrix)
{
    if (matrix.rows != matrix.columns) throw MathError(ErrorCode::Argument, "The sparse matrix is not square (" + std::to_string(matrix.rows) + "×" + std::to_string(matrix.columns) + ")");
}

//The options of an iterative solver: its tolerance (of ‖b - A x‖ / ‖b‖), its largest number of iterations
template <typename Solver>
SparseResults iterate(const SparseArgument &matrix, const std::vector<MatrixArgument> &dense, const std::vector<double> &numbers)
{
    requireSquareSparse(matrix);
    if (dense.empty() || dense.size() > 2 || dense[0].columns != 1) throw MathError(ErrorCode::Argument, "An iterative solver takes a right side and a guess, as vectors");
    requireRows(dense[0], matrix.rows, "The right side");
    if (dense.size() == 2) {
        requireRows(dense[1], matrix.rows, "The guess");
        if (dense[1].columns != 1) throw MathError(ErrorCode::Argument, "The guess is a vector");
    }
    if (numbers.size() != 2) throw MathError(ErrorCode::Argument, "An iterative solver takes a tolerance and a number of iterations");
    const double tolerance = numbers[0], iterations = numbers[1];
    if (!(tolerance >= 0) || !std::isfinite(tolerance)) throw MathError(ErrorCode::Argument, "The tolerance is a number of 0 or more");
    if (iterations != std::floor(iterations) || iterations < 0 || iterations > 2147483647.0) throw MathError(ErrorCode::Argument, "The number of iterations is an integer from 0 to 2^31 - 1");
    const Eigen::Index n = static_cast<Eigen::Index>(matrix.rows);
    const Eigen::Map<const Eigen::VectorXd> right(dense[0].values, n);
    Eigen::VectorXd solution = Eigen::VectorXd::Zero(n);
    double steps = 0, error = 0, converged = 1;
    if (n > 0) {
        const SparseRows a = mapOf(matrix);
        Solver solver;
        solver.setTolerance(tolerance);
        solver.setMaxIterations(static_cast<Eigen::Index>(iterations));
        solver.compute(a);
        solution = dense.size() == 2 ? Eigen::VectorXd(solver.solveWithGuess(right, Eigen::Map<const Eigen::VectorXd>(dense[1].values, n))) : Eigen::VectorXd(solver.solve(right));
        steps = static_cast<double>(solver.iterations());
        error = solver.error();
        converged = solver.info() == Eigen::Success ? 1 : 0;
    }
    SparseResults results;
    results.dense = {resultOf(solution), MatrixResult{1, 3, {steps, error, converged}}};
    return results;
}

}

SparseResults sparseOf(const std::string &operation, const std::vector<SparseArgument> &sparse, const std::vector<MatrixArgument> &dense, const std::vector<double> &numbers)
{
    for (const SparseArgument &matrix : sparse) check(matrix);
    SparseResults results;
    if (operation == "multiply") {
        if (sparse.size() != 2) throw MathError(ErrorCode::Argument, "The operation multiply takes 2 sparse matrices");
        if (sparse[0].columns != sparse[1].rows) {
            throw MathError(ErrorCode::Argument, "The sparse matrices cannot be multiplied: " + std::to_string(sparse[0].rows) + "×" + std::to_string(sparse[0].columns) + " by " + std::to_string(sparse[1].rows) + "×" + std::to_string(sparse[1].columns));
        }
        SparseRows product = mapOf(sparse[0]) * mapOf(sparse[1]);
        results.sparse = {sparseResultOf(std::move(product))};
        return results;
    }
    if (operation == "solve") {
        //The sparse LU decomposition: a matrix it cannot factorize (a pivot of 0, or a structure of no full rank) is
        //singular
        if (sparse.size() != 1 || dense.size() != 1) throw MathError(ErrorCode::Argument, "The operation solve takes a sparse matrix and a right side");
        requireSquareSparse(sparse[0]);
        requireRows(dense[0], sparse[0].rows, "The right side");
        if (sparse[0].rows == 0) {
            results.dense = {resultOf(Eigen::MatrixXd(0, static_cast<Eigen::Index>(dense[0].columns)))};
            return results;
        }
        const SparseColumns a = mapOf(sparse[0]);
        Eigen::SparseLU<SparseColumns, Eigen::COLAMDOrdering<int>> lu;
        lu.analyzePattern(a);
        lu.factorize(a);
        if (lu.info() != Eigen::Success) throw MathError(ErrorCode::Domain, "The matrix is singular");
        checkpoint();
        const Eigen::MatrixXd solution = lu.solve(copyOf(dense[0]));
        results.dense = {resultOf(solution)};
        return results;
    }
    if (operation == "conjugateGradient") {
        //Of a symmetric positive definite matrix (not checked), the whole of it read (Lower | Upper)
        if (sparse.size() != 1) throw MathError(ErrorCode::Argument, "The operation conjugateGradient takes a sparse matrix");
        return iterate<Eigen::ConjugateGradient<SparseRows, Eigen::Lower | Eigen::Upper, Eigen::DiagonalPreconditioner<double>>>(sparse[0], dense, numbers);
    }
    if (operation == "biconjugateGradientStabilized") {
        if (sparse.size() != 1) throw MathError(ErrorCode::Argument, "The operation biconjugateGradientStabilized takes a sparse matrix");
        return iterate<Eigen::BiCGSTAB<SparseRows, Eigen::DiagonalPreconditioner<double>>>(sparse[0], dense, numbers);
    }
    throw MathError(ErrorCode::Argument, "Unknown operation on sparse matrices: " + operation);
}

}
