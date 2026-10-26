//The parser of the formulas of @lakutata/math: one way to write them (see the guide), parsed into the expressions of
//SymEngine. = is an equation, never an assignment; an unknown function is an error, not a product.
#pragma once

#include <functional>
#include <string>
#include <vector>

#include "../core/Handle.h"

namespace math {

//A function or a constant defined by a formula (see Scope): its parameters (symbols), its body
struct Definition {
    std::vector<Expr> parameters;
    Expr body;
    bool function;
};

//The definitions the parser sees: the scope, and while a definition is compiled, its parameters
using Resolver = std::function<const Definition *(const std::string &name)>;

//What a text is: an expression, an equation (left = right), or an inequality (left < right…)
struct Parsed {
    enum class Kind { Expression, Equation, Relation };
    Kind kind;
    Expr left;
    Expr right;
    std::string relation;
};

//Parse a formula, an equation or an inequality
Parsed parse(const std::string &text, const Resolver &resolver);

//Parse an expression: an equation or an inequality is an error
Expr parseExpression(const std::string &text, const Resolver &resolver);

//The exact value of a decimal number without sign (12, 0.5, 1.5e-3): 0.1 is 1/10
Expr parseNumber(const std::string &text);

//Whether a name is one of the functions or constants of the parser (it cannot be defined)
bool isBuiltin(const std::string &name);

//Whether a name cannot be a variable: a constant, or a function whose name alone is an error (sin)
bool isReserved(const std::string &name);

//Whether a text is a name: a letter or _, then letters, digits or _ (the letters of every alphabet)
bool isName(const std::string &text);

//The index in a text of UTF-8 of a byte, counted in characters of UTF-16 (as JavaScript counts)
long utf16Index(const std::string &text, size_t byte);

}
