#include "Parser.h"

#include "../functions/Functions.h"

#include <map>
#include <symengine/add.h>
#include <symengine/constants.h>
#include <symengine/functions.h>
#include <symengine/infinity.h>
#include <symengine/integer.h>
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
        return functions;
    }());
    return table;
}

const std::map<std::string, Expr> &constants()
{
    static const std::map<std::string, Expr> &table = *new std::map<std::string, Expr>{
        {"pi", pi}, {"e", E}, {"i", I}, {"inf", Inf}, {"oo", Inf}, {"nan", Nan},
        //The constants the printer writes, read back
        {"complexInfinity", ComplexInf}, {"EulerGamma", EulerGamma}, {"Catalan", Catalan}, {"GoldenRatio", GoldenRatio}
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
            if (symbol == "!=") throw MathError(ErrorCode::NotSupported, "≠ (!=) is not supported: a formula has = or an inequality", utf16Index(text, start));
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

class Parser {
public:
    Parser(const std::string &text, const Resolver &resolver) : text_(text), tokens_(tokenize(text)), resolver_(resolver)
    {
    }

    Parsed parseAll()
    {
        if (peek().type == TokenType::End) throw MathError(ErrorCode::Syntax, "The formula is empty", 0);
        Parsed parsed{Parsed::Kind::Expression, sum(), Expr(), ""};
        const Token &next = peek();
        if (next.type == TokenType::Operator && (next.text == "=" || next.text == "<" || next.text == ">" || next.text == "<=" || next.text == ">=")) {
            index_++;
            parsed.kind = next.text == "=" ? Parsed::Kind::Equation : Parsed::Kind::Relation;
            parsed.relation = next.text;
            parsed.right = sum();
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

    Expr sum()
    {
        Expr value = term();
        while (true) {
            if (accept("+")) value = add(value, term());
            else if (accept("-")) value = sub(value, term());
            else return value;
        }
    }

    Expr term()
    {
        Expr value = unary();
        while (true) {
            const Token &next = peek();
            if (accept("*")) value = mul(value, unary());
            else if (accept("/")) value = div(value, unary());
            //The implicit products: 2x, 2(x + 1), (x + 1)(x - 1), 2 sin(x)
            else if (next.type == TokenType::Name || (next.type == TokenType::Operator && next.text == "(")) value = mul(value, power());
            else return value;
        }
    }

    Expr unary()
    {
        //A formula nested deeper than the expressions can be, refused before its recursion fills the stack
        if (depth_ > MAX_DEPTH) fail(peek(), "The formula is nested more than " + std::to_string(MAX_DEPTH) + " levels deep", ErrorCode::NotSupported);
        depth_++;
        struct Leave {
            unsigned &depth;
            ~Leave() { depth--; }
        } leave{depth_};
        if (accept("-")) return neg(unary());
        if (accept("+")) return unary();
        return power();
    }

    Expr power()
    {
        Expr base = postfix();
        //Right-associative: 2^3^2 is 2^(3^2); the exponent can be negative: 2^-3
        if (accept("^")) return pow(base, unary());
        return base;
    }

    Expr postfix()
    {
        Expr value = primary();
        while (accept("!")) value = factorialOf(value);
        return value;
    }

    std::vector<Expr> arguments()
    {
        std::vector<Expr> values;
        expect("(");
        if (!accept(")")) {
            do values.push_back(sum());
            while (accept(","));
            expect(")");
        }
        return values;
    }

    Expr primary()
    {
        const Token token = peek();
        if (token.type == TokenType::Number) {
            index_++;
            return numberOf(token.text);
        }
        if (token.type == TokenType::Operator && token.text == "(") {
            index_++;
            Expr value = sum();
            expect(")");
            return value;
        }
        if (token.type == TokenType::Operator && token.text == "[") {
            fail(token, "Matrices are not written in formulas yet: give them to matrix()", ErrorCode::NotSupported);
        }
        if (token.type != TokenType::Name) unexpected(token);
        index_++;
        const Token &next = peek();
        const bool call = next.type == TokenType::Operator && next.text == "(";
        if (const Definition *definition = resolver_(token.text)) {
            if (!definition->function) return definition->body;
            if (!call) fail(token, token.text + " is a function: write " + token.text + "(…)");
            const std::vector<Expr> values = arguments();
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
            return value;
        }
        const auto constant = constants().find(token.text);
        if (constant != constants().end()) return constant->second;
        const auto function = builtins().find(token.text);
        if (function != builtins().end()) {
            if (!call) fail(token, token.text + " is a function: write " + token.text + "(…)");
            const std::vector<Expr> values = arguments();
            if (values.size() < function->second.minimum || values.size() > function->second.maximum) {
                const Builtin &builtin = function->second;
                const std::string count = builtin.minimum == builtin.maximum ? std::to_string(builtin.minimum)
                    : builtin.maximum == SIZE_MAX ? std::to_string(builtin.minimum) + " or more" : std::to_string(builtin.minimum) + " or " + std::to_string(builtin.maximum);
                fail(token, token.text + " takes " + count + " argument" + (builtin.maximum == 1 ? "" : "s"));
            }
            return function->second.build(vec_basic(values.begin(), values.end()));
        }
        //A name followed by ( without a space is a call: an unknown function, not a product
        if (call && !next.spaceBefore) {
            fail(token, "Unknown function " + token.text + ": to multiply, write " + token.text + "*(…)", ErrorCode::UnknownFunction);
        }
        return symbol(token.text);
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
    if (parsed.kind != Parsed::Kind::Expression) throw MathError(ErrorCode::Syntax, "An expression is expected, not an equation or an inequality");
    return parsed.left;
}

Expr parseNumber(const std::string &text)
{
    return numberOf(text);
}

bool isBuiltin(const std::string &name)
{
    return builtins().count(name) || constants().count(name);
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
