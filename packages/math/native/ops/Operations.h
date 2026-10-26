//The operations on the expressions: the ones of SymEngine, completed (exact numbers from the numbers of JavaScript,
//series at any point, the solutions of an equation as JavaScript reads them)
#pragma once

#include <complex>
#include <string>
#include <utility>
#include <vector>

#include "../core/Handle.h"

namespace math {

//The exact value of a number of JavaScript: the decimal it prints as (0.1 is 1/10)
Expr numberFromDouble(double value);

//The value of an expression without variables as a number of JavaScript (an error for a complex value)
double toDouble(const Expr &expression);

//The value of an expression without variables as a complex number
std::complex<double> toComplex(const Expr &expression);

//The names of the variables of an expression, sorted
std::vector<std::string> variablesOf(const Expr &expression);

//Whether two expressions are equal: their difference expanded, or simplified, is zero
bool equalsOf(const Expr &a, const Expr &b);

//An operation of arithmetic on two expressions: + - * / ^, or neg (the opposite of the first one)
Expr arithmeticOf(const std::string &operation, const Expr &a, const Expr &b);

Expr expandOf(const Expr &expression);

Expr simplifyOf(const Expr &expression);

//The derivative of an expression by a variable, a number of times
Expr differentiate(const Expr &expression, const std::string &variable, unsigned times);

//An expression with variables replaced by expressions
Expr substitute(const Expr &expression, const std::vector<std::pair<std::string, Expr>> &values);

//The series of an expression at a point, its terms of degree lower than an order
Expr seriesOf(const Expr &expression, const std::string &variable, const Expr &point, unsigned order);

//An interval of solutions: its ends, whether they are excluded
struct SolutionInterval {
    Expr start;
    Expr end;
    bool startOpen;
    bool endOpen;
};

//The solutions of an equation: some values (finite), none (empty), every value (all), intervals, or a set not
//solved (unsolved, other) given as text
struct Solutions {
    std::string kind;
    std::vector<Expr> values;
    std::vector<SolutionInterval> intervals;
    std::string text;
};

//The solutions of expression = 0 for a variable, in the complex numbers or the real ones
Solutions solveOf(const Expr &expression, const std::string &variable, bool real);

//The solution of a system of linear equations: none (empty), or the values of the variables it determines (finite),
//in terms of the other ones when it does not determine them all
struct LinearSolution {
    std::string kind;
    std::vector<std::pair<std::string, Expr>> values;
};

//The solution of a system of linear equations (expressions = 0) for variables, by exact elimination
LinearSolution solveLinearOf(const std::vector<Expr> &equations, const std::vector<std::string> &variables);

}
