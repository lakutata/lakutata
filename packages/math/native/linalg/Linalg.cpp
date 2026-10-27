//The dense linear algebra on Eigen: products, linear systems, inverses, determinants, singular values. The products map
//the row-major elements in place; the decompositions work on a column-major copy (nothing next to their cost, and one
//instantiation of each).
#include "Linalg.h"
#include "LinalgSupport.h"

#include <cmath>
#include <limits>

#include <Eigen/Dense>

#include "../async/Pool.h"
#include "../core/Errors.h"

namespace math {

namespace {

using RowMajor = RowMajorMatrix;

[[noreturn]] void singular()
{
    throw MathError(ErrorCode::Domain, "The matrix is singular");
}

//The LU decomposition of a square matrix with partial pivoting; singular where it meets a pivot of exactly 0 (as
//NumPy: a matrix close to singular gives its large values)
Eigen::PartialPivLU<Eigen::MatrixXd> luOf(const MatrixArgument &matrix)
{
    Eigen::PartialPivLU<Eigen::MatrixXd> lu(copyOf(matrix));
    return lu;
}

bool zeroPivot(const Eigen::PartialPivLU<Eigen::MatrixXd> &lu)
{
    const auto diagonal = lu.matrixLU().diagonal();
    for (Eigen::Index i = 0; i < diagonal.size(); i++) {
        if (diagonal[i] == 0) return true;
    }
    return false;
}

}

std::vector<MatrixResult> linalgOf(const std::string &operation, const std::vector<MatrixArgument> &matrices, const std::vector<double> &, const std::string &option)
{
    if (operation == "multiply") {
        requireCount(matrices, 2, operation);
        const MatrixArgument &a = matrices[0], &b = matrices[1];
        if (a.columns != b.rows) {
            throw MathError(ErrorCode::Argument, "The matrices cannot be multiplied: " + std::to_string(a.rows) + "×" + std::to_string(a.columns) + " by " + std::to_string(b.rows) + "×" + std::to_string(b.columns));
        }
        RowMajor product = mapOf(a) * mapOf(b);
        return {resultOf(product)};
    }
    if (operation == "solve") {
        requireCount(matrices, 2, operation);
        requireSquare(matrices[0], "The matrix of the system");
        requireRows(matrices[1], matrices[0].rows, "The right-hand side");
        if (matrices[0].rows == 0) return {MatrixResult{0, matrices[1].columns, {}}};
        const auto lu = luOf(matrices[0]);
        if (zeroPivot(lu)) singular();
        checkpoint();
        return {resultOf(lu.solve(copyOf(matrices[1])))};
    }
    if (operation == "solveTriangular") {
        requireCount(matrices, 2, operation);
        requireSquare(matrices[0], "The triangular matrix");
        requireRows(matrices[1], matrices[0].rows, "The right-hand side");
        if (option != "lower" && option != "upper") throw MathError(ErrorCode::Argument, "A triangular matrix is lower or upper");
        if (matrices[0].rows == 0) return {MatrixResult{0, matrices[1].columns, {}}};
        const Eigen::MatrixXd a = copyOf(matrices[0]);
        for (Eigen::Index i = 0; i < a.rows(); i++) {
            if (a(i, i) == 0) singular();
        }
        const Eigen::MatrixXd b = copyOf(matrices[1]);
        if (option == "lower") return {resultOf(a.triangularView<Eigen::Lower>().solve(b))};
        return {resultOf(a.triangularView<Eigen::Upper>().solve(b))};
    }
    if (operation == "leastSquares") {
        //The minimum-norm least-squares solution, by the singular values above max(m, n) eps of the largest (NumPy's
        //lstsq)
        requireCount(matrices, 2, operation);
        requireRows(matrices[1], matrices[0].rows, "The right-hand side");
        const Eigen::MatrixXd a = copyOf(matrices[0]);
        if (a.size() == 0) return {resultOf(Eigen::MatrixXd::Zero(a.cols(), static_cast<Eigen::Index>(matrices[1].columns)))};
        Eigen::BDCSVD<Eigen::MatrixXd, Eigen::ComputeThinU | Eigen::ComputeThinV> svd(a);
        svd.setThreshold(std::numeric_limits<double>::epsilon() * static_cast<double>(std::max(a.rows(), a.cols())));
        checkpoint();
        return {resultOf(svd.solve(copyOf(matrices[1])))};
    }
    if (operation == "inverse") {
        requireCount(matrices, 1, operation);
        requireSquare(matrices[0], "The matrix");
        if (matrices[0].rows == 0) return {MatrixResult{0, 0, {}}};
        const auto lu = luOf(matrices[0]);
        if (zeroPivot(lu)) singular();
        checkpoint();
        return {resultOf(lu.inverse())};
    }
    if (operation == "determinant") {
        requireCount(matrices, 1, operation);
        requireSquare(matrices[0], "The matrix");
        if (matrices[0].rows == 0) return {numberOf(1)};
        //No negative 0 (the sign of the permutation times a pivot of 0)
        const double determinant = luOf(matrices[0]).determinant();
        return {numberOf(determinant == 0 ? 0.0 : determinant)};
    }
    if (operation == "singularValues") {
        //Descending
        requireCount(matrices, 1, operation);
        const Eigen::MatrixXd a = copyOf(matrices[0]);
        if (a.size() == 0) return {MatrixResult{0, 1, {}}};
        Eigen::BDCSVD<Eigen::MatrixXd> svd(a);
        return {resultOf(svd.singularValues())};
    }
    throw MathError(ErrorCode::Argument, "Unknown operation of the linear algebra: " + operation);
}

}
