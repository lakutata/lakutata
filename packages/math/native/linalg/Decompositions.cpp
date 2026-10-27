//The decompositions of matrices on Eigen: LU with partial pivoting, QR and the singular value decomposition (thin),
//Cholesky's, the eigenvalues and eigenvectors (of a general matrix, of a symmetric one), the real Schur form, and the
//pseudo-inverse by the singular values. The ones of a symmetric matrix read its lower triangle, as NumPy's.
#include "LinalgSupport.h"

#include <algorithm>
#include <cmath>
#include <limits>

#include <Eigen/Cholesky>
#include <Eigen/Eigenvalues>
#include <Eigen/LU>
#include <Eigen/QR>
#include <Eigen/SVD>

#include "../async/Pool.h"

namespace math {

namespace {

//The singular values below which a value is 0: max(m, n) eps of the largest (NumPy's pinv and matrix_rank), or a
//tolerance given
double thresholdOf(const Eigen::VectorXd &values, Eigen::Index rows, Eigen::Index columns, const std::vector<double> &numbers)
{
    if (!numbers.empty()) return numbers[0];
    return values.size() ? values[0] * static_cast<double>(std::max(rows, columns)) * std::numeric_limits<double>::epsilon() : 0;
}

}

bool decompositionOf(const std::string &operation, const std::vector<MatrixArgument> &matrices, const std::vector<double> &numbers, std::vector<MatrixResult> &results)
{
    if (operation == "lu") {
        //P A = L U: L of ones on its diagonal, the permutation as the rows of A taken in turn (row i of P A is row p[i]
        //of A)
        requireCount(matrices, 1, operation);
        requireSquare(matrices[0], "The matrix");
        const Eigen::Index n = static_cast<Eigen::Index>(matrices[0].rows);
        if (n == 0) {
            results = {resultOf(Eigen::MatrixXd(0, 0)), resultOf(Eigen::MatrixXd(0, 0)), MatrixResult{0, 1, {}}};
            return true;
        }
        const Eigen::PartialPivLU<Eigen::MatrixXd> lu(copyOf(matrices[0]));
        checkpoint();
        Eigen::MatrixXd lower = lu.matrixLU().triangularView<Eigen::StrictlyLower>();
        lower.diagonal().setOnes();
        const Eigen::MatrixXd upper = lu.matrixLU().triangularView<Eigen::Upper>();
        const Eigen::VectorXd indices = Eigen::VectorXd::LinSpaced(n, 0, static_cast<double>(n - 1));
        const Eigen::VectorXd permutation = lu.permutationP() * indices;
        results = {resultOf(lower), resultOf(upper), resultOf(permutation)};
        return true;
    }
    if (operation == "qr") {
        //Thin: Q of m×k orthonormal columns, R of k×n upper triangular, k = min(m, n)
        requireCount(matrices, 1, operation);
        const Eigen::MatrixXd a = copyOf(matrices[0]);
        const Eigen::Index k = std::min(a.rows(), a.cols());
        if (k == 0) {
            results = {resultOf(Eigen::MatrixXd::Zero(a.rows(), 0)), resultOf(Eigen::MatrixXd::Zero(0, a.cols()))};
            return true;
        }
        const Eigen::HouseholderQR<Eigen::MatrixXd> qr(a);
        checkpoint();
        const Eigen::MatrixXd q = qr.householderQ() * Eigen::MatrixXd::Identity(a.rows(), k);
        const Eigen::MatrixXd r = qr.matrixQR().topRows(k).triangularView<Eigen::Upper>();
        results = {resultOf(q), resultOf(r)};
        return true;
    }
    if (operation == "cholesky") {
        //A = L Lᵀ of a symmetric positive definite matrix, its lower triangle read
        requireCount(matrices, 1, operation);
        requireSquare(matrices[0], "The matrix");
        if (matrices[0].rows == 0) {
            results = {resultOf(Eigen::MatrixXd(0, 0))};
            return true;
        }
        const Eigen::LLT<Eigen::MatrixXd, Eigen::Lower> llt(copyOf(matrices[0]));
        if (llt.info() != Eigen::Success) throw MathError(ErrorCode::Domain, "The matrix is not positive definite");
        results = {resultOf(Eigen::MatrixXd(llt.matrixL()))};
        return true;
    }
    if (operation == "svd") {
        //Thin: A = U diag(s) Vᵀ, U of m×k, V of n×k, k = min(m, n), s descending
        requireCount(matrices, 1, operation);
        const Eigen::MatrixXd a = copyOf(matrices[0]);
        const Eigen::Index k = std::min(a.rows(), a.cols());
        if (k == 0) {
            results = {resultOf(Eigen::MatrixXd::Zero(a.rows(), 0)), MatrixResult{0, 1, {}}, resultOf(Eigen::MatrixXd::Zero(a.cols(), 0))};
            return true;
        }
        const Eigen::BDCSVD<Eigen::MatrixXd, Eigen::ComputeThinU | Eigen::ComputeThinV> svd(a);
        results = {resultOf(svd.matrixU()), resultOf(svd.singularValues()), resultOf(svd.matrixV())};
        return true;
    }
    if (operation == "eigen") {
        //Of a general matrix: complex eigenvalues (their real and imaginary parts), eigenvectors of norm 1 as columns
        requireCount(matrices, 1, operation);
        requireSquare(matrices[0], "The matrix");
        const Eigen::Index n = static_cast<Eigen::Index>(matrices[0].rows);
        if (n == 0) {
            results = {MatrixResult{0, 1, {}}, MatrixResult{0, 1, {}}, resultOf(Eigen::MatrixXd(0, 0)), resultOf(Eigen::MatrixXd(0, 0))};
            return true;
        }
        const Eigen::EigenSolver<Eigen::MatrixXd> solver(copyOf(matrices[0]));
        if (solver.info() != Eigen::Success) throw MathError(ErrorCode::NotSupported, "The eigenvalues of the matrix did not converge");
        const Eigen::VectorXcd values = solver.eigenvalues();
        const Eigen::MatrixXcd vectors = solver.eigenvectors();
        results = {resultOf(values.real()), resultOf(values.imag()), resultOf(vectors.real()), resultOf(vectors.imag())};
        return true;
    }
    if (operation == "symmetricEigen") {
        //Of a symmetric matrix, its lower triangle read (NumPy's eigh): eigenvalues ascending, orthonormal eigenvectors
        requireCount(matrices, 1, operation);
        requireSquare(matrices[0], "The matrix");
        if (matrices[0].rows == 0) {
            results = {MatrixResult{0, 1, {}}, resultOf(Eigen::MatrixXd(0, 0))};
            return true;
        }
        const Eigen::SelfAdjointEigenSolver<Eigen::MatrixXd> solver(copyOf(matrices[0]));
        if (solver.info() != Eigen::Success) throw MathError(ErrorCode::NotSupported, "The eigenvalues of the matrix did not converge");
        results = {resultOf(solver.eigenvalues()), resultOf(solver.eigenvectors())};
        return true;
    }
    if (operation == "schur") {
        //A = U T Uᵀ: U orthogonal, T quasi upper triangular (blocks of 2×2 on its diagonal for the pairs of complex
        //eigenvalues)
        requireCount(matrices, 1, operation);
        requireSquare(matrices[0], "The matrix");
        if (matrices[0].rows == 0) {
            results = {resultOf(Eigen::MatrixXd(0, 0)), resultOf(Eigen::MatrixXd(0, 0))};
            return true;
        }
        const Eigen::RealSchur<Eigen::MatrixXd> schur(copyOf(matrices[0]));
        if (schur.info() != Eigen::Success) throw MathError(ErrorCode::NotSupported, "The Schur form of the matrix did not converge");
        results = {resultOf(schur.matrixU()), resultOf(schur.matrixT())};
        return true;
    }
    if (operation == "pseudoInverse") {
        //V diag(1/s) Uᵀ of the singular values above the threshold
        requireCount(matrices, 1, operation);
        const Eigen::MatrixXd a = copyOf(matrices[0]);
        if (std::min(a.rows(), a.cols()) == 0) {
            results = {resultOf(Eigen::MatrixXd::Zero(a.cols(), a.rows()))};
            return true;
        }
        const Eigen::BDCSVD<Eigen::MatrixXd, Eigen::ComputeThinU | Eigen::ComputeThinV> svd(a);
        checkpoint();
        const Eigen::VectorXd &values = svd.singularValues();
        const double threshold = thresholdOf(values, a.rows(), a.cols(), numbers);
        Eigen::VectorXd inverse(values.size());
        for (Eigen::Index i = 0; i < values.size(); i++) inverse[i] = values[i] > threshold ? 1 / values[i] : 0;
        results = {resultOf(svd.matrixV() * inverse.asDiagonal() * svd.matrixU().transpose())};
        return true;
    }
    return false;
}

}
