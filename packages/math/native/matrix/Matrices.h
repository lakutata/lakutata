//The matrices of expressions (ExpressionMatrix): immutable, their elements expressions of SymEngine, row by row. Their
//operations are exact: the determinant and the characteristic polynomial by Berkowitz's algorithm (without division),
//the inverse and the solutions of a matrix with variables by its adjugate, the reduced row echelon form by elimination;
//an element counts as 0 when it is 0 once expanded, when its decimals cannot tell it from 0 (a constant), or when it
//is 0 at every value of its variables (checked at two).
#pragma once

#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "../core/Handle.h"

namespace math {

struct ExpressionMatrix {
    unsigned rows = 0;
    unsigned columns = 0;
    std::vector<Expr> elements;

    const Expr &at(unsigned i, unsigned j) const
    {
        return elements[static_cast<size_t>(i) * columns + j];
    }
};

using MatrixPointer = std::shared_ptr<const ExpressionMatrix>;

//A matrix of its rows (all of the same length, at least one element; MathError Argument otherwise)
MatrixPointer matrixOfRows(const std::vector<std::vector<Expr>> &rows);

//A matrix of its dimensions and its elements, row by row
MatrixPointer matrixOf(unsigned rows, unsigned columns, std::vector<Expr> elements);

//Whether an element is 0: expanded, 0; a constant, told from 0 by its decimals; with variables, 0 at two values of
//them, exactly
bool knownZero(const Expr &element);

//The operations of the matrices of expressions, by name: their arguments matrices, expressions and numbers; their
//results a matrix, an expression or matrices (the others empty)
struct ExpressionMatrixResult {
    MatrixPointer matrix;
    Expr expression;
    std::vector<MatrixPointer> matrices;
    std::vector<Expr> expressions;
    std::vector<double> numbers;
    std::string text;
};

ExpressionMatrixResult matrixOperation(const std::string &operation, const std::vector<MatrixPointer> &matrices, const std::vector<Expr> &expressions, const std::vector<double> &numbers, const std::vector<std::string> &names);

//The arithmetic of the formulas: a + b, a - b, a * b (a matrix or an expression each), a / b (b an expression), a^k
MatrixPointer addMatrices(const ExpressionMatrix &a, const ExpressionMatrix &b, bool subtract);
MatrixPointer multiplyMatrices(const ExpressionMatrix &a, const ExpressionMatrix &b);
MatrixPointer scaleMatrix(const ExpressionMatrix &a, const Expr &factor);
MatrixPointer powerOfMatrix(const ExpressionMatrix &a, const Expr &exponent);
MatrixPointer transposeOf(const ExpressionMatrix &a);
Expr traceOf(const ExpressionMatrix &a);
Expr determinantOf(const ExpressionMatrix &a);
MatrixPointer inverseOf(const ExpressionMatrix &a);

//The text of a matrix in the syntax of the formulas ([1, x; 2, y]), and its LaTeX (a bmatrix)
std::string matrixText(const ExpressionMatrix &a);
std::string matrixTeX(const ExpressionMatrix &a);

//The approximate native memory of a matrix
size_t matrixMemory(const ExpressionMatrix &a);

//A matrix given to JavaScript (each element no deeper than MAX_DEPTH), and the matrix of a handle
Napi::Value wrapMatrix(Napi::Env env, const MatrixPointer &matrix);
MatrixPointer unwrapMatrix(const Napi::Value &value);

}
