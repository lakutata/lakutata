#include "Parser.h"

#include "../functions/Functions.h"
#include "../ops/Piecewise.h"

#include <map>
#include <set>
#include <symengine/add.h>
#include <symengine/constants.h>
#include <symengine/functions.h>
#include <symengine/infinity.h>
#include <symengine/integer.h>
#include <symengine/logic.h>
#include <symengine/mul.h>
#include <symengine/nan.h>
#include <symengine/ntheory.h>
#include <symengine/pow.h>
#include <symengine/rational.h>
#include <symengine/subs.h>
#include <symengine/symbol.h>

namespace math {

using namespace SymEngine;

namespace {

//The functions of the formulas: their numbers of arguments, how they are built
struct Builtin {
    size_t minimum;
    size_t maximum;
    std::function<Expr(const vec_basic &)> build;
};

//n! and factorial(n): exact for a natural number up to 20000, the gamma function otherwise (gamma(n + 1) stays as
//written above the limit of the exact numbers)
Expr factorialOf(const Expr &n)
{
    if (is_a<Integer>(*n)) {
        const Integer &value = down_cast<const Integer &>(*n);
        if (value.is_negative()) throw MathError(ErrorCode::Domain, "The factorial of a negative integer is undefined");
        if (value.as_integer_class() <= 20000) return factorial(static_cast<unsigned long>(value.as_uint()));
    }
    return gamma(add(n, one));
}

Expr binomialOf(const Expr &n, const Expr &k)
{
    if (is_a<Integer>(*n) && is_a<Integer>(*k)) {
        const Integer &top = down_cast<const Integer &>(*n);
        const Integer &bottom = down_cast<const Integer &>(*k);
        if (bottom.is_negative()) return zero;
        //Not more than 20000 factors, as the factorials: the smaller of k and n - k, else the form of gamma below
        const integer_class other = top.as_integer_class() - bottom.as_integer_class();
        if (bottom.as_integer_class() <= 20000) return binomial(top, static_cast<unsigned long>(bottom.as_uint()));
        if (other >= 0 && other <= 20000) return binomial(top, static_cast<unsigned long>(mp_get_ui(other)));
    }
    return div(gamma(add(n, one)), mul(gamma(add(k, one)), gamma(add(sub(n, k), one))));
}

//gcd and lcm of integers (of polynomials later): non-negative
Expr integerGcdLcm(const vec_basic &arguments, bool gcdWanted)
{
    RCP<const Integer> result;
    for (const Expr &argument : arguments) {
        if (!is_a<Integer>(*argument)) throw MathError(ErrorCode::NotSupported, std::string(gcdWanted ? "gcd" : "lcm") + " is computed for integers");
        const RCP<const Integer> value = rcp_static_cast<const Integer>(argument);
        result = result.is_null() ? rcp_static_cast<const Integer>(abs(value)) : gcdWanted ? gcd(*result, *value) : lcm(*result, *value);
    }
    return result;
}

//The functions whose name without parentheses is an error rather than a variable: the ones written so by mistake
const std::set<std::string> &strictFunctions()
{
    static const std::set<std::string> &names = *new std::set<std::string>{
        "sin", "cos", "tan", "cot", "sec", "csc", "asin", "acos", "atan", "acot", "asec", "acsc",
        "sinh", "cosh", "tanh", "coth", "sech", "csch", "asinh", "acosh", "atanh", "acoth", "asech", "acsch",
        "exp", "ln", "log", "log10", "log2", "sqrt", "cbrt", "piecewise"};
    return names;
}

//A piecewise expression of cases (a value and a condition), its conditions of constants decided
Expr piecewiseOf(const PiecewiseVec &cases)
{
    const Expr result = piecewise(cases);
    return is_a<Piecewise>(*result) ? mergedOf(settledOf(result)) : result;
}

//Heaviside's step: 0 below 0, 1/2 at 0, 1 above (as SymPy's Heaviside and nerdamer's step)
Expr stepOf(const Expr &x)
{
    return piecewiseOf({{zero, relationOf("<", x, zero)}, {rational(1, 2), relationOf("=", x, zero)}, {one, boolTrue}});
}

//The rectangular function: 1 for |x| < 1/2, 1/2 at |x| = 1/2, else 0 (nerdamer's rect)
Expr rectOf(const Expr &x)
{
    const Expr size = abs(x), half = rational(1, 2);
    return piecewiseOf({{one, relationOf("<", size, half)}, {half, relationOf("=", size, half)}, {zero, boolTrue}});
}

//The triangular function: 1 - |x| for |x| < 1, else 0 (nerdamer's tri)
Expr triOf(const Expr &x)
{
    const Expr size = abs(x);
    return piecewiseOf({{sub(one, size), relationOf("<", size, one)}, {zero, boolTrue}});
}

//The words of the conditions of piecewise
const std::set<std::string> &conditionWords()
{
    static const std::set<std::string> &words = *new std::set<std::string>{"and", "or", "not"};
    return words;
}

const std::map<std::string, Builtin> &builtins()
{
    //The tables of the file are never destroyed: the threads of the addon may still use them while the process exits
    static const std::map<std::string, Builtin> &table = *new std::map<std::string, Builtin>([] {
        std::map<std::string, Builtin> functions;
        auto unary = [&functions](const std::string &name, Expr (*f)(const Expr &)) {
            functions[name] = {1, 1, [f](const vec_basic &a) { return f(a[0]); }};
        };
        unary("sin", sin);
        unary("cos", cos);
        unary("tan", tan);
        unary("cot", cot);
        unary("sec", sec);
        unary("csc", csc);
        unary("asin", asin);
        unary("acos", acos);
        unary("atan", atan);
        unary("acot", acot);
        unary("asec", asec);
        unary("acsc", acsc);
        unary("sinh", sinh);
        unary("cosh", cosh);
        unary("tanh", tanh);
        unary("coth", coth);
        unary("sech", sech);
        unary("csch", csch);
        unary("asinh", asinh);
        unary("acosh", acosh);
        unary("atanh", atanh);
        unary("acoth", acoth);
        unary("asech", asech);
        unary("acsch", acsch);
        unary("exp", exp);
        unary("sqrt", sqrt);
        unary("abs", abs);
        unary("sign", sign);
        unary("floor", floor);
        unary("ceil", ceiling);
        unary("trunc", truncate);
        unary("conj", conjugate);
        unary("gamma", gamma);
        unary("loggamma", loggamma);
        unary("digamma", digamma);
        unary("erf", erf);
        unary("erfc", erfc);
        unary("lambertw", lambertw);
        unary("factorial", factorialOf);
        functions["ln"] = {1, 1, [](const vec_basic &a) { return log(a[0]); }};
        functions["log"] = {1, 2, [](const vec_basic &a) { return a.size() == 1 ? log(a[0]) : log(a[0], a[1]); }};
        functions["log10"] = {1, 1, [](const vec_basic &a) { return log(a[0], integer(10)); }};
        functions["log2"] = {1, 1, [](const vec_basic &a) { return log(a[0], integer(2)); }};
        //The real root of a negative real number for an odd order (cbrt(-8) is -2), the principal one otherwise
        functions["cbrt"] = {1, 1, [](const vec_basic &a) { return realRoot(a[0], integer(3)); }};
        functions["root"] = {2, 2, [](const vec_basic &a) { return realRoot(a[0], a[1]); }};
        functions["atan2"] = {2, 2, [](const vec_basic &a) { return atan2(a[0], a[1]); }};
        functions["beta"] = {2, 2, [](const vec_basic &a) { return beta(a[0], a[1]); }};
        functions["polygamma"] = {2, 2, [](const vec_basic &a) { return polygamma(a[0], a[1]); }};
        functions["zeta"] = {1, 2, [](const vec_basic &a) { return a.size() == 1 ? zeta(a[0]) : zeta(a[0], a[1]); }};
        functions["binomial"] = {2, 2, [](const vec_basic &a) { return binomialOf(a[0], a[1]); }};
        functions["min"] = {1, SIZE_MAX, [](const vec_basic &a) { return min(a); }};
        functions["max"] = {1, SIZE_MAX, [](const vec_basic &a) { return max(a); }};
        //The functions of the addon (functions/Functions.h)
        unary("round", roundOf);
        unary("sinc", sincOf);
        unary("re", realPartOf);
        unary("im", imaginaryPartOf);
        unary("arg", argumentOf);
        functions["mod"] = {2, 2, [](const vec_basic &a) { return modOf(a[0], a[1]); }};
        //Written with the others, without a function of their own
        functions["hypot"] = {2, 2, [](const vec_basic &a) { return sqrt(add(pow(a[0], integer(2)), pow(a[1], integer(2)))); }};
        functions["expm1"] = {1, 1, [](const vec_basic &a) { return sub(exp(a[0]), one); }};
        functions["log1p"] = {1, 1, [](const vec_basic &a) { return log(add(one, a[0])); }};
        functions["lowergamma"] = {2, 2, [](const vec_basic &a) { return lowergamma(a[0], a[1]); }};
        functions["uppergamma"] = {2, 2, [](const vec_basic &a) { return uppergamma(a[0], a[1]); }};
        //The piecewise functions; piecewise() itself is read by the parser (its conditions are not expressions)
        unary("step", stepOf);
        unary("rect", rectOf);
        unary("tri", triOf);
        functions["piecewise"] = {1, SIZE_MAX, [](const vec_basic &) -> Expr { throw MathError(ErrorCode::Syntax, "piecewise takes conditions"); }};
        functions["gcd"] = {2, SIZE_MAX, [](const vec_basic &a) { return integerGcdLcm(a, true); }};
        functions["lcm"] = {2, SIZE_MAX, [](const vec_basic &a) { return integerGcdLcm(a, false); }};
        return functions;
    }());
    return table;
}

const std::map<std::string, Expr> &constants()
{
    static const std::map<std::string, Expr> &table = *new std::map<std::string, Expr>{
        {"pi", pi}, {"e", E}, {"i", I}, {"inf", Inf}, {"oo", Inf}, {"nan", Nan},
        //The constants the printer writes, read back
        {"complexInfinity", ComplexInf}, {"EulerGamma", EulerGamma}, {"Catalan", Catalan}, {"GoldenRatio", GoldenRatio},
        //The golden ratio, 2pi
        {"phi", GoldenRatio}, {"tau", mul(integer(2), pi)}
    };
    return table;
}

enum class TokenType { Number, Name, Operator, End };

struct Token {
    TokenType type;
    std::string text;
    size_t start;
    bool spaceBefore;
};

bool nameStart(unsigned char c)
{
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_' || c >= 0x80;
}

bool nameCharacter(unsigned char c)
{
    return nameStart(c) || (c >= '0' && c <= '9');
}

bool digit(unsigned char c)
{
    return c >= '0' && c <= '9';
}

std::vector<Token> tokenize(const std::string &text)
{
    std::vector<Token> tokens;
    size_t at = 0;
    bool space = false;
    while (at < text.size()) {
        const unsigned char c = text[at];
        if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
            at++;
            space = true;
            continue;
        }
        const size_t start = at;
        if (digit(c) || (c == '.' && at + 1 < text.size() && digit(text[at + 1]))) {
            while (at < text.size() && digit(text[at])) at++;
            if (at < text.size() && text[at] == '.') {
                at++;
                while (at < text.size() && digit(text[at])) at++;
            }
            //An exponent only when digits follow: 2e is 2 times e
            if (at < text.size() && (text[at] == 'e' || text[at] == 'E')) {
                size_t exponent = at + 1;
                if (exponent < text.size() && (text[exponent] == '+' || text[exponent] == '-')) exponent++;
                if (exponent < text.size() && digit(text[exponent])) {
                    at = exponent;
                    while (at < text.size() && digit(text[at])) at++;
                }
            }
            tokens.push_back({TokenType::Number, text.substr(start, at - start), start, space});
        } else if (nameStart(c)) {
            while (at < text.size() && nameCharacter(text[at])) at++;
            tokens.push_back({TokenType::Name, text.substr(start, at - start), start, space});
        } else {
            static const char *const twoCharacters[] = {"<=", ">=", "**", "!=", nullptr};
            std::string symbol(1, static_cast<char>(c));
            for (const char *const *two = twoCharacters; *two; two++) {
                if (text.compare(at, 2, *two) == 0) symbol = *two;
            }
            if (std::string("+-*/^!=<>()[],;").find(static_cast<char>(c)) == std::string::npos && symbol.size() == 1) {
                throw MathError(ErrorCode::Syntax, "Unexpected character " + std::string(1, static_cast<char>(c)), utf16Index(text, start));
            }
            at += symbol.size();
            tokens.push_back({TokenType::Operator, symbol == "**" ? "^" : symbol, start, space});
        }
        space = false;
    }
    tokens.push_back({TokenType::End, "", text.size(), space});
    return tokens;
}

//A decimal number as an exact rational: 0.1 is 1/10
Expr numberOf(const std::string &text)
{
    std::string mantissa;
    long exponent = 0;
    size_t at = 0;
    bool fraction = false;
    for (; at < text.size() && text[at] != 'e' && text[at] != 'E'; at++) {
        if (text[at] == '.') {
            fraction = true;
            continue;
        }
        mantissa += text[at];
        if (fraction) exponent--;
    }
    if (at < text.size()) exponent += std::stol(text.substr(at + 1));
    if (exponent > 100000 || exponent < -100000) throw MathError(ErrorCode::NotSupported, "The exponent of " + text + " is too large");
    const size_t first = mantissa.find_first_not_of('0');
    Expr value = integer(integer_class(first == std::string::npos ? "0" : mantissa.substr(first)));
    if (exponent > 0) return mul(value, pow(integer(10), integer(exponent)));
    if (exponent < 0) return div(value, pow(integer(10), integer(-exponent)));
    return value;
}

//The functions of the matrices in the formulas: a matrix their argument
const std::set<std::string> &matrixFunctions()
{
    static const std::set<std::string> &names = *new std::set<std::string>{"det", "inv", "transpose", "trace"};
    return names;
}

//A value of the formulas: an expression, or a matrix of expressions ([1, 2; 3, 4] and the operations on it)
struct Value {
    Expr scalar;
    MatrixPointer matrix;

    bool isMatrix() const
    {
        return matrix != nullptr;
    }
};

Value scalarValue(const Expr &expression)
{
    return Value{expression, nullptr};
}

Value matrixValue(const MatrixPointer &matrix)
{
    return Value{Expr(), matrix};
}

class Parser {
public:
    Parser(const std::string &text, const Resolver &resolver) : text_(text), tokens_(tokenize(text)), resolver_(resolver)
    {
    }

    Parsed parseAll()
    {
        if (peek().type == TokenType::End) throw MathError(ErrorCode::Syntax, "The formula is empty", 0);
        const Token &startToken = peek();
        const Value left = sum();
        Parsed parsed{Parsed::Kind::Expression, left.scalar, Expr(), "", left.matrix};
        if (left.isMatrix()) parsed.kind = Parsed::Kind::Matrix;
        const Token &next = peek();
        if (next.type == TokenType::Operator && next.text == "!=") fail(next, "≠ (!=) is not supported: a formula has = or an inequality (!= is a comparison of the conditions of piecewise)", ErrorCode::NotSupported);
        if (next.type == TokenType::Operator && (next.text == "=" || next.text == "<" || next.text == ">" || next.text == "<=" || next.text == ">=")) {
            const Token relationToken = next;
            index_++;
            const Value right = sum();
            if (left.isMatrix() || right.isMatrix()) fail(left.isMatrix() ? startToken : relationToken, "An equation or an inequality of matrices is not solved", ErrorCode::NotSupported);
            parsed.kind = relationToken.text == "=" ? Parsed::Kind::Equation : Parsed::Kind::Relation;
            parsed.relation = relationToken.text;
            parsed.right = right.scalar;
            const Token &after = peek();
            if (after.type == TokenType::Operator && (after.text == "=" || after.text == "<" || after.text == ">" || after.text == "<=" || after.text == ">=")) {
                fail(after, "A formula has one = or one inequality");
            }
        }
        if (peek().type != TokenType::End) unexpected(peek());
        return parsed;
    }

private:
    const std::string &text_;
    std::vector<Token> tokens_;
    const Resolver &resolver_;
    size_t index_ = 0;
    unsigned depth_ = 0;
    //Inside a condition of piecewise: and, or and not end a product there
    unsigned conditionDepth_ = 0;

    bool acceptWord(const char *word)
    {
        if (peek().type == TokenType::Name && peek().text == word) {
            index_++;
            return true;
        }
        return false;
    }

    static bool isComparison(const Token &token)
    {
        return token.type == TokenType::Operator && (token.text == "<" || token.text == "<=" || token.text == ">" || token.text == ">=" || token.text == "=" || token.text == "!=");
    }

    //piecewise(v1, c1, v2, c2, …, v): a value and its condition, and the value where none of them holds last
    Value piecewiseCall(const Token &token)
    {
        expect("(");
        PiecewiseVec cases;
        while (true) {
            const Token at = peek();
            const Expr value = scalarOf(sum(), at, "piecewise");
            if (accept(")")) {
                if (cases.empty()) fail(token, "piecewise takes a value and its condition at least");
                cases.emplace_back(value, boolTrue);
                break;
            }
            expect(",");
            cases.emplace_back(value, condition());
            if (accept(")")) break;
            expect(",");
        }
        return scalarValue(piecewiseOf(cases));
    }

    //A condition: its parts joined by or, then by and, a part negated by not, a comparison
    RCP<const Boolean> condition()
    {
        conditionDepth_++;
        struct Leave {
            unsigned &depth;
            ~Leave() { depth--; }
        } leave{conditionDepth_};
        set_boolean parts{conjunction()};
        while (acceptWord("or")) parts.insert(conjunction());
        return parts.size() == 1 ? *parts.begin() : logical_or(parts);
    }

    RCP<const Boolean> conjunction()
    {
        set_boolean parts{negation()};
        while (acceptWord("and")) parts.insert(negation());
        return parts.size() == 1 ? *parts.begin() : logical_and(parts);
    }

    RCP<const Boolean> negation()
    {
        if (depth_ > MAX_DEPTH) fail(peek(), "The formula is nested more than " + std::to_string(MAX_DEPTH) + " levels deep", ErrorCode::NotSupported);
        depth_++;
        struct Leave {
            unsigned &depth;
            ~Leave() { depth--; }
        } leave{depth_};
        if (acceptWord("not")) return logical_not(negation());
        //A condition in parentheses, unless they hold a sum compared after them ((x + 1) < 2)
        if (peek().type == TokenType::Operator && peek().text == "(") {
            const size_t start = index_;
            try {
                index_++;
                const RCP<const Boolean> inside = condition();
                expect(")");
                if (!isComparison(peek())) return inside;
            } catch (const MathError &) {
            }
            index_ = start;
        }
        return comparison();
    }

    //Comparisons, written one after the other: 0 <= x < 1 is 0 <= x and x < 1
    RCP<const Boolean> comparison()
    {
        const Token start = peek();
        Expr left = scalarOf(sum(), start, "A condition");
        if (!isComparison(peek())) fail(peek(), "A condition compares values: <, <=, >, >=, = or !=");
        set_boolean parts;
        while (isComparison(peek())) {
            const Token relation = peek();
            index_++;
            const Token at = peek();
            const Expr right = scalarOf(sum(), at, "A condition");
            try {
                parts.insert(relationOf(relation.text, left, right));
            } catch (const MathError &error) {
                fail(relation, error.what(), error.code());
            }
            left = right;
        }
        return parts.size() == 1 ? *parts.begin() : logical_and(parts);
    }

    const Token &peek() const
    {
        return tokens_[index_];
    }

    bool accept(const char *op)
    {
        if (peek().type == TokenType::Operator && peek().text == op) {
            index_++;
            return true;
        }
        return false;
    }

    [[noreturn]] void fail(const Token &token, const std::string &message, ErrorCode code = ErrorCode::Syntax) const
    {
        throw MathError(code, message, utf16Index(text_, token.start));
    }

    [[noreturn]] void unexpected(const Token &token) const
    {
        if (token.type == TokenType::End) fail(token, "The formula ends too early");
        fail(token, "Unexpected " + token.text);
    }

    void expect(const char *op)
    {
        if (!accept(op)) {
            if (peek().type == TokenType::End) fail(peek(), std::string("The formula ends too early: ") + op + " expected");
            fail(peek(), std::string("Unexpected ") + peek().text + ": " + op + " expected");
        }
    }

    //An operation of the matrices, its errors at a token
    template <typename F>
    Value matrixOperation(const Token &token, F operation)
    {
        try {
            return matrixValue(operation());
        } catch (const MathError &error) {
            if (error.position() >= 0) throw;
            fail(token, error.what(), error.code());
        }
    }

    Value plus(const Value &a, const Value &b, const Token &token, bool subtract)
    {
        if (!a.isMatrix() && !b.isMatrix()) return scalarValue(subtract ? sub(a.scalar, b.scalar) : add(a.scalar, b.scalar));
        if (!a.isMatrix() || !b.isMatrix()) fail(token, std::string("A matrix and a number are not ") + (subtract ? "subtracted" : "added") + ": write the number times the identity");
        return matrixOperation(token, [&] { return addMatrices(*a.matrix, *b.matrix, subtract); });
    }

    Value times(const Value &a, const Value &b, const Token &token)
    {
        if (!a.isMatrix() && !b.isMatrix()) return scalarValue(mul(a.scalar, b.scalar));
        if (a.isMatrix() && b.isMatrix()) return matrixOperation(token, [&] { return multiplyMatrices(*a.matrix, *b.matrix); });
        return matrixOperation(token, [&] { return a.isMatrix() ? scaleMatrix(*a.matrix, b.scalar) : scaleMatrix(*b.matrix, a.scalar); });
    }

    Value divided(const Value &a, const Value &b, const Token &token)
    {
        if (b.isMatrix()) fail(token, "A matrix does not divide: multiply by inv(…)");
        if (!a.isMatrix()) return scalarValue(div(a.scalar, b.scalar));
        if (knownZero(b.scalar)) fail(token, "A matrix divided by 0", ErrorCode::DivisionByZero);
        return matrixOperation(token, [&] { return scaleMatrix(*a.matrix, div(one, b.scalar)); });
    }

    //A scalar, where a matrix is not taken
    const Expr &scalarOf(const Value &value, const Token &token, const std::string &what)
    {
        if (value.isMatrix()) fail(token, what + " takes numbers, not a matrix");
        return value.scalar;
    }

    Value sum()
    {
        Value value = term();
        while (true) {
            const Token token = peek();
            if (accept("+")) value = plus(value, term(), token, false);
            else if (accept("-")) value = plus(value, term(), token, true);
            else return value;
        }
    }

    Value term()
    {
        Value value = unary();
        while (true) {
            const Token next = peek();
            if (accept("*")) value = times(value, unary(), next);
            else if (accept("/")) value = divided(value, unary(), next);
            //The implicit products: 2x, 2(x + 1), (x + 1)(x - 1), 2 sin(x), 2[1, 2]
            else if (conditionDepth_ > 0 && next.type == TokenType::Name && conditionWords().count(next.text)) return value;
            else if (next.type == TokenType::Name || (next.type == TokenType::Operator && (next.text == "(" || next.text == "["))) value = times(value, power(), next);
            else return value;
        }
    }

    Value unary()
    {
        //A formula nested deeper than the expressions can be, refused before its recursion fills the stack
        if (depth_ > MAX_DEPTH) fail(peek(), "The formula is nested more than " + std::to_string(MAX_DEPTH) + " levels deep", ErrorCode::NotSupported);
        depth_++;
        struct Leave {
            unsigned &depth;
            ~Leave() { depth--; }
        } leave{depth_};
        const Token token = peek();
        if (accept("-")) {
            const Value value = unary();
            if (!value.isMatrix()) return scalarValue(neg(value.scalar));
            return matrixOperation(token, [&] { return scaleMatrix(*value.matrix, minus_one); });
        }
        if (accept("+")) return unary();
        return power();
    }

    Value power()
    {
        const Value base = postfix();
        //Right-associative: 2^3^2 is 2^(3^2); the exponent can be negative: 2^-3
        const Token token = peek();
        if (accept("^")) {
            const Value exponent = unary();
            if (exponent.isMatrix()) fail(token, "A power has a number for exponent, not a matrix");
            if (!base.isMatrix()) return scalarValue(pow(base.scalar, exponent.scalar));
            return matrixOperation(token, [&] { return powerOfMatrix(*base.matrix, exponent.scalar); });
        }
        return base;
    }

    Value postfix()
    {
        Value value = primary();
        while (true) {
            const Token token = peek();
            if (!accept("!")) return value;
            value = scalarValue(factorialOf(scalarOf(value, token, "!")));
        }
    }

    std::vector<Value> arguments()
    {
        std::vector<Value> values;
        expect("(");
        if (!accept(")")) {
            do values.push_back(sum());
            while (accept(","));
            expect(")");
        }
        return values;
    }

    //The arguments of a function of numbers: a matrix is an error
    std::vector<Expr> scalarArguments(const Token &token)
    {
        std::vector<Expr> scalars;
        for (const Value &value : arguments()) scalars.push_back(scalarOf(value, token, token.text));
        return scalars;
    }

    //A matrix written [1, 2; 3, 4]: its rows separated by ;, the elements of a row by ,
    Value matrixLiteral(const Token &open)
    {
        std::vector<std::vector<Expr>> rows(1);
        if (accept("]")) fail(open, "A matrix has at least one element");
        while (true) {
            const Token token = peek();
            const Value element = sum();
            if (element.isMatrix()) fail(token, "A matrix is not an element of a matrix");
            rows.back().push_back(element.scalar);
            if (accept(",")) continue;
            const Token separator = peek();
            if (accept(";")) {
                if (rows.back().size() != rows.front().size()) fail(separator, "The rows of a matrix are of the same length");
                rows.emplace_back();
                continue;
            }
            const Token close = peek();
            expect("]");
            if (rows.back().size() != rows.front().size()) fail(close, "The rows of a matrix are of the same length");
            return matrixValue(matrixOfRows(rows));
        }
    }

    Value primary()
    {
        const Token token = peek();
        if (token.type == TokenType::Number) {
            index_++;
            return scalarValue(numberOf(token.text));
        }
        if (token.type == TokenType::Operator && token.text == "(") {
            index_++;
            Value value = sum();
            expect(")");
            return value;
        }
        if (token.type == TokenType::Operator && token.text == "[") {
            index_++;
            return matrixLiteral(token);
        }
        if (token.type != TokenType::Name) unexpected(token);
        if (conditionWords().count(token.text)) fail(token, token.text + " is a word of the conditions of piecewise");
        index_++;
        const Token &next = peek();
        const bool call = next.type == TokenType::Operator && next.text == "(";
        const Definition *definition = resolver_(token.text);
        //A constant (or a parameter) followed by ( without a space: the function of the formulas of that name (a
        //parameter gamma, gamma(x)), else an error as for a variable, not a product
        const bool callsBuiltin = definition && !definition->function && call && !next.spaceBefore && (builtins().count(token.text) || matrixFunctions().count(token.text));
        if (definition && !definition->function && call && !next.spaceBefore && !callsBuiltin) {
            fail(token, token.text + " is not a function: to multiply, write " + token.text + "*(…)", ErrorCode::UnknownFunction);
        }
        if (definition && !callsBuiltin) {
            if (!definition->function) return scalarValue(definition->body);
            if (!call) fail(token, token.text + " is a function: write " + token.text + "(…)");
            const std::vector<Expr> values = scalarArguments(token);
            if (values.size() != definition->parameters.size()) {
                fail(token, token.text + " takes " + std::to_string(definition->parameters.size()) + " argument" + (definition->parameters.size() == 1 ? "" : "s"));
            }
            map_basic_basic replacements;
            for (size_t i = 0; i < values.size(); i++) replacements[definition->parameters[i]] = values[i];
            //The definitions composed in each other double the depth at each level: checked at each call
            Expr value = subs(definition->body, replacements);
            try {
                checkDepth(value);
            } catch (const MathError &error) {
                fail(token, error.what(), ErrorCode::NotSupported);
            }
            return scalarValue(value);
        }
        //The functions of the matrices: det, inv, transpose, trace of a matrix
        if (call && matrixFunctions().count(token.text)) {
            const std::vector<Value> values = arguments();
            if (values.size() != 1) fail(token, token.text + " takes 1 argument");
            if (!values[0].isMatrix()) fail(token, token.text + " takes a matrix");
            const ExpressionMatrix &matrix = *values[0].matrix;
            try {
                if (token.text == "det") return scalarValue(determinantOf(matrix));
                if (token.text == "trace") return scalarValue(traceOf(matrix));
                if (token.text == "inv") return matrixValue(inverseOf(matrix));
                return matrixValue(transposeOf(matrix));
            } catch (const MathError &error) {
                if (error.position() >= 0) throw;
                fail(token, error.what(), error.code());
            }
        }
        if (call && token.text == "piecewise") return piecewiseCall(token);
        const auto constant = constants().find(token.text);
        if (constant != constants().end()) return scalarValue(constant->second);
        const auto function = builtins().find(token.text);
        //Without parentheses, the functions written so by mistake (sin x) are an error, the other names are variables:
        //gamma, beta, re, arg, mod… are common names of quantities
        if (function != builtins().end() && !call && strictFunctions().count(token.text)) {
            fail(token, token.text + " is a function: write " + token.text + "(…)");
        }
        if (function != builtins().end() && call) {
            const std::vector<Expr> values = scalarArguments(token);
            if (values.size() < function->second.minimum || values.size() > function->second.maximum) {
                const Builtin &builtin = function->second;
                const std::string count = builtin.minimum == builtin.maximum ? std::to_string(builtin.minimum)
                    : builtin.maximum == SIZE_MAX ? std::to_string(builtin.minimum) + " or more" : std::to_string(builtin.minimum) + " or " + std::to_string(builtin.maximum);
                fail(token, token.text + " takes " + count + " argument" + (builtin.maximum == 1 ? "" : "s"));
            }
            return scalarValue(function->second.build(vec_basic(values.begin(), values.end())));
        }
        //A name followed by ( without a space is a call: an unknown function, not a product
        if (call && !next.spaceBefore) {
            fail(token, "Unknown function " + token.text + ": to multiply, write " + token.text + "*(…)", ErrorCode::UnknownFunction);
        }
        return scalarValue(symbol(token.text));
    }
};

}

Parsed parse(const std::string &text, const Resolver &resolver)
{
    return Parser(text, resolver).parseAll();
}

Expr parseExpression(const std::string &text, const Resolver &resolver)
{
    Parsed parsed = parse(text, resolver);
    if (parsed.kind == Parsed::Kind::Matrix) throw MathError(ErrorCode::Syntax, "An expression is expected, not a matrix");
    if (parsed.kind != Parsed::Kind::Expression) throw MathError(ErrorCode::Syntax, "An expression is expected, not an equation or an inequality");
    return parsed.left;
}

Expr parseNumber(const std::string &text)
{
    return numberOf(text);
}

bool isBuiltin(const std::string &name)
{
    return builtins().count(name) || constants().count(name) || matrixFunctions().count(name) || conditionWords().count(name);
}

bool isReserved(const std::string &name)
{
    return strictFunctions().count(name) || constants().count(name) || conditionWords().count(name) || name == "piecewise";
}

bool isName(const std::string &text)
{
    if (text.empty() || !nameStart(text[0])) return false;
    for (const char c : text) {
        if (!nameCharacter(c)) return false;
    }
    return true;
}

long utf16Index(const std::string &text, size_t byte)
{
    long index = 0;
    for (size_t at = 0; at < byte && at < text.size();) {
        const unsigned char c = text[at];
        const size_t length = c < 0x80 ? 1 : (c >> 5) == 0x6 ? 2 : (c >> 4) == 0xe ? 3 : 4;
        index += length == 4 ? 2 : 1;
        at += length;
    }
    return index;
}

}
