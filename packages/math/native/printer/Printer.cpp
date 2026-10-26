#include "Printer.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <map>
#include <set>
#include <vector>
#include <symengine/add.h>
#include <symengine/complex.h>
#include <symengine/complex_double.h>
#include <symengine/constants.h>
#include <symengine/functions.h>
#include <symengine/infinity.h>
#include <symengine/integer.h>
#include <symengine/logic.h>
#include <symengine/mul.h>
#include <symengine/nan.h>
#include <symengine/pow.h>
#include <symengine/printers/strprinter.h>
#include <symengine/rational.h>
#include <symengine/real_double.h>
#include <symengine/symbol.h>

namespace math {

using namespace SymEngine;

std::string doubleText(double value)
{
    if (std::isnan(value)) return "nan";
    if (std::isinf(value)) return value > 0 ? "inf" : "-inf";
    char buffer[40];
    for (int precision = 1; precision <= 17; precision++) {
        std::snprintf(buffer, sizeof(buffer), "%.*g", precision, value);
        if (std::strtod(buffer, nullptr) == value) break;
    }
    return buffer;
}

namespace {

enum Precedence { ADD = 1, MUL = 2, POW = 3, ATOM = 4 };

//What a printed part starts and ends with: the products decide on the implicit ones
enum class Lead { Digit, Letter, Paren, Other };

struct Part {
    std::string text;
    int precedence;
    Lead lead;
    bool endsWithParen;
    bool endsWithI;
};

//The numeric coefficient and the factors of a term
struct Factors {
    RCP<const Number> coefficient;
    std::vector<Expr> numerator;
    std::vector<Expr> denominator;
};

//A term as a monomial: the exponents of its symbols, when it is one (its coefficient aside)
struct Monomial {
    bool polynomial = true;
    long degree = 0;
    std::map<std::string, long> exponents;
};

Monomial monomialOf(const Expr &term)
{
    Monomial monomial;
    auto addFactor = [&monomial](const Expr &base, const Expr &exponent) {
        if (is_a<Symbol>(*base) && is_a<Integer>(*exponent) && down_cast<const Integer &>(*exponent).is_positive()
            && down_cast<const Integer &>(*exponent).as_integer_class() < 1000000) {
            const long power = static_cast<long>(down_cast<const Integer &>(*exponent).as_int());
            monomial.exponents[down_cast<const Symbol &>(*base).get_name()] += power;
            monomial.degree += power;
        } else {
            monomial.polynomial = false;
        }
    };
    if (is_a_Number(*term)) return monomial;
    if (is_a<Symbol>(*term)) addFactor(term, one);
    else if (is_a<Pow>(*term)) addFactor(down_cast<const Pow &>(*term).get_base(), down_cast<const Pow &>(*term).get_exp());
    else if (is_a<Mul>(*term)) {
        for (const auto &[base, exponent] : down_cast<const Mul &>(*term).get_dict()) addFactor(base, exponent);
    } else monomial.polynomial = false;
    return monomial;
}

//The rank of a term in a sum: the monomials of a degree, then the other terms, then the constant
int termRank(const Monomial &monomial)
{
    if (!monomial.polynomial) return 1;
    return monomial.degree > 0 ? 0 : 2;
}

//Whether a number prints with a minus: a negative real, a complex of a negative real part (or of no real part and a
//negative imaginary one)
bool isNegativeNumber(const Number &number)
{
    if (is_a<Complex>(number)) {
        const Complex &complex = down_cast<const Complex &>(number);
        return complex.real_ == 0 ? complex.imaginary_ < 0 : complex.real_ < 0;
    }
    if (is_a<Integer>(number) || is_a<Rational>(number) || is_a<RealDouble>(number)) return number.is_negative();
    return false;
}

bool isNegative(const Expr &term)
{
    if (is_a<Integer>(*term) || is_a<Rational>(*term)) return down_cast<const Number &>(*term).is_negative();
    if (is_a<RealDouble>(*term)) return down_cast<const RealDouble &>(*term).i < 0;
    if (is_a<Infty>(*term)) return down_cast<const Infty &>(*term).is_negative_infinity();
    if (is_a<Mul>(*term)) return isNegativeNumber(*down_cast<const Mul &>(*term).get_coef());
    if (is_a<Complex>(*term)) {
        const Complex &complex = down_cast<const Complex &>(*term);
        return complex.real_ == 0 && complex.imaginary_ < 0;
    }
    return false;
}

//The rank of a factor in a product: the constants (pi), the symbols and their powers, the functions, the sums
int factorRank(const Expr &factor)
{
    Expr base = is_a<Pow>(*factor) ? down_cast<const Pow &>(*factor).get_base() : factor;
    if (is_a<Constant>(*base)) return 0;
    if (is_a<Symbol>(*base)) return 1;
    if (is_a_sub<Function>(*base)) return 2;
    if (is_a<Add>(*base)) return 3;
    return 4;
}

std::string factorKey(const Expr &factor)
{
    Expr base = is_a<Pow>(*factor) ? down_cast<const Pow &>(*factor).get_base() : factor;
    if (is_a<Symbol>(*base)) return down_cast<const Symbol &>(*base).get_name();
    return base->__str__();
}

const std::vector<std::string> &functionNames()
{
    //The tables of the file are never destroyed: the threads of the addon may still use them while the process exits
    static const std::vector<std::string> &names = *new std::vector<std::string>([] {
        std::vector<std::string> table = init_str_printer_names();
        table[SYMENGINE_LOG] = "ln";
        table[SYMENGINE_CEILING] = "ceil";
        table[SYMENGINE_TRUNCATE] = "trunc";
        table[SYMENGINE_CONJUGATE] = "conj";
        return table;
    }());
    return names;
}

const std::map<std::string, std::string> &texFunctions()
{
    static const std::map<std::string, std::string> &table = *new std::map<std::string, std::string>{
        {"sin", "\\sin"}, {"cos", "\\cos"}, {"tan", "\\tan"}, {"cot", "\\cot"}, {"sec", "\\sec"}, {"csc", "\\csc"},
        {"asin", "\\arcsin"}, {"acos", "\\arccos"}, {"atan", "\\arctan"}, {"sinh", "\\sinh"}, {"cosh", "\\cosh"},
        {"tanh", "\\tanh"}, {"coth", "\\coth"}, {"ln", "\\ln"}, {"gamma", "\\Gamma"}, {"max", "\\max"}, {"min", "\\min"}
    };
    return table;
}

const std::set<std::string> &greekLetters()
{
    static const std::set<std::string> &letters = *new std::set<std::string>{
        "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu", "nu",
        "xi", "omicron", "rho", "sigma", "tau", "upsilon", "phi", "chi", "psi", "omega", "Gamma", "Delta", "Theta",
        "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega"
    };
    return letters;
}

class Printer {
public:
    explicit Printer(bool tex) : tex_(tex)
    {
    }

    Part print(const Expr &e)
    {
        if (is_a<Add>(*e)) return printAdd(e);
        if (is_a<Mul>(*e)) return printMul(e);
        if (is_a<Pow>(*e)) return printPow(e);
        if (is_a<Symbol>(*e)) return atom(symbolText(down_cast<const Symbol &>(*e).get_name()), Lead::Letter);
        if (is_a<Integer>(*e)) {
            const Integer &value = down_cast<const Integer &>(*e);
            std::string text = value.__str__();
            return value.is_negative() ? Part{text, MUL, Lead::Other, false, false} : atom(text, Lead::Digit);
        }
        if (is_a<Rational>(*e)) return printRational(down_cast<const Rational &>(*e));
        if (is_a<Complex>(*e)) return printComplex(down_cast<const Complex &>(*e));
        if (is_a<RealDouble>(*e)) {
            const double value = down_cast<const RealDouble &>(*e).i;
            return value < 0 ? Part{doubleText(value), MUL, Lead::Other, false, false} : atom(doubleText(value), Lead::Digit);
        }
        if (is_a<ComplexDouble>(*e)) {
            const std::complex<double> value = down_cast<const ComplexDouble &>(*e).i;
            std::string imaginary = doubleText(std::abs(value.imag())) + (tex_ ? " i" : "i");
            if (value.real() == 0) return Part{(value.imag() < 0 ? "-" : "") + imaginary, MUL, value.imag() < 0 ? Lead::Other : Lead::Digit, false, true};
            return Part{doubleText(value.real()) + (value.imag() < 0 ? " - " : " + ") + imaginary, ADD, Lead::Other, false, true};
        }
        if (is_a<Constant>(*e)) return printConstant(down_cast<const Constant &>(*e).get_name());
        if (is_a<Infty>(*e)) {
            const Infty &infinity = down_cast<const Infty &>(*e);
            if (infinity.is_unsigned_infinity()) return atom(tex_ ? "\\tilde{\\infty}" : "complexInfinity", Lead::Letter);
            if (infinity.is_negative_infinity()) return Part{tex_ ? "-\\infty" : "-inf", MUL, Lead::Other, false, false};
            return atom(tex_ ? "\\infty" : "inf", Lead::Letter);
        }
        if (is_a<NaN>(*e)) return atom(tex_ ? "\\mathrm{NaN}" : "nan", Lead::Letter);
        if (is_a<BooleanAtom>(*e)) return atom(down_cast<const BooleanAtom &>(*e).get_val() ? "true" : "false", Lead::Letter);
        if (is_a<FunctionSymbol>(*e)) return printCall(down_cast<const FunctionSymbol &>(*e).get_name(), e->get_args());
        if (is_a<FunctionWrapper>(*e)) return printWrapper(down_cast<const FunctionWrapper &>(*e));
        if (is_a_sub<Function>(*e)) {
            const std::vector<std::string> &names = functionNames();
            const TypeID code = e->get_type_code();
            if (code < names.size() && !names[code].empty()) return printFunction(names[code], e);
        }
        return atom(e->__str__(), Lead::Other);
    }

private:
    bool tex_;

    static Part atom(const std::string &text, Lead lead)
    {
        return {text, ATOM, lead, false, false};
    }

    std::string paren(const std::string &text) const
    {
        return tex_ ? "\\left(" + text + "\\right)" : "(" + text + ")";
    }

    Part parenthesized(const Part &part) const
    {
        return {paren(part.text), ATOM, Lead::Paren, true, false};
    }

    std::string symbolText(const std::string &name) const
    {
        if (!tex_) return name;
        const size_t underscore = name.find('_');
        std::string head = name.substr(0, underscore);
        if (greekLetters().count(head)) head = "\\" + head;
        else if (head.size() > 1) head = "\\mathit{" + head + "}";
        if (underscore == std::string::npos) return head;
        return head + "_{" + name.substr(underscore + 1) + "}";
    }

    Part printConstant(const std::string &name) const
    {
        static const std::map<std::string, std::pair<std::string, std::string>> &names = *new std::map<std::string, std::pair<std::string, std::string>>{
            {"pi", {"pi", "\\pi"}}, {"E", {"e", "e"}}, {"EulerGamma", {"EulerGamma", "\\gamma"}},
            {"Catalan", {"Catalan", "G"}}, {"GoldenRatio", {"GoldenRatio", "\\phi"}}
        };
        const auto found = names.find(name);
        const std::string text = found == names.end() ? name : tex_ ? found->second.second : found->second.first;
        return atom(text, Lead::Letter);
    }

    Part printRational(const Rational &value) const
    {
        const integer_class &top = get_num(value.as_rational_class());
        const integer_class &bottom = get_den(value.as_rational_class());
        std::string numerator = SymEngine::Integer(top < 0 ? integer_class(-top) : top).__str__();
        std::string denominator = SymEngine::Integer(bottom).__str__();
        const std::string sign = top < 0 ? "-" : "";
        if (tex_) return {sign + "\\frac{" + numerator + "}{" + denominator + "}", MUL, top < 0 ? Lead::Other : Lead::Digit, false, false};
        return {sign + numerator + "/" + denominator, MUL, top < 0 ? Lead::Other : Lead::Digit, false, false};
    }

    //The imaginary part a of a i, without its sign: i, 2i, i/2, 3i/2
    std::string imaginaryText(const rational_class &part) const
    {
        const integer_class top = get_num(part) < 0 ? integer_class(-get_num(part)) : get_num(part);
        const integer_class &bottom = get_den(part);
        const std::string coefficient = top == 1 ? "" : SymEngine::Integer(top).__str__();
        if (tex_) {
            std::string text = coefficient.empty() ? "i" : coefficient + " i";
            return bottom == 1 ? text : "\\frac{" + text + "}{" + SymEngine::Integer(bottom).__str__() + "}";
        }
        return coefficient + "i" + (bottom == 1 ? "" : "/" + SymEngine::Integer(bottom).__str__());
    }

    Part printComplex(const Complex &value)
    {
        const bool negative = value.imaginary_ < 0;
        const std::string imaginary = imaginaryText(value.imaginary_);
        const bool simple = get_den(value.imaginary_) == 1;
        if (value.real_ == 0) {
            //i alone is an atom, 2i a product (the base of a power in parentheses: (2i)^x)
            return {(negative ? "-" : "") + imaginary, negative || imaginary != "i" ? MUL : ATOM, negative ? Lead::Other : simple && imaginary[0] == 'i' ? Lead::Letter : Lead::Digit, false, simple};
        }
        std::string real = Printer(tex_).print(Rational::from_mpq(value.real_)).text;
        return {real + (negative ? " - " : " + ") + imaginary, ADD, Lead::Other, false, simple};
    }

    //The functions of the addon (functions/Functions.h): root(x, 3) is cbrt(x), a root \sqrt[n]{x} in LaTeX
    Part printWrapper(const FunctionWrapper &function)
    {
        const vec_basic arguments = function.get_args();
        if (function.get_name() == "root") {
            const bool cube = eq(*arguments[1], *integer(3));
            if (!tex_) return cube ? printCall("cbrt", {arguments[0]}) : printCall("root", arguments);
            return {"\\sqrt[" + print(arguments[1]).text + "]{" + print(arguments[0]).text + "}", ATOM, Lead::Other, false, false};
        }
        return printCall(function.get_name(), arguments);
    }

    Part printCall(const std::string &name, const vec_basic &arguments)
    {
        std::string text;
        for (const Expr &argument : arguments) text += (text.empty() ? "" : ", ") + print(argument).text;
        if (!tex_) return {name + "(" + text + ")", ATOM, Lead::Letter, true, false};
        return {"\\operatorname{" + name + "}\\left(" + text + "\\right)", ATOM, Lead::Letter, true, false};
    }

    Part printFunction(const std::string &name, const Expr &e)
    {
        const vec_basic arguments = e->get_args();
        if (tex_) {
            if (name == "abs") return atom("\\left|" + print(arguments[0]).text + "\\right|", Lead::Other);
            if (name == "floor") return atom("\\left\\lfloor " + print(arguments[0]).text + " \\right\\rfloor", Lead::Other);
            if (name == "ceil") return atom("\\left\\lceil " + print(arguments[0]).text + " \\right\\rceil", Lead::Other);
            const auto known = texFunctions().find(name);
            if (known != texFunctions().end()) {
                std::string text;
                for (const Expr &argument : arguments) text += (text.empty() ? "" : ", ") + print(argument).text;
                return {known->second + "\\left(" + text + "\\right)", ATOM, Lead::Letter, true, false};
            }
        }
        return printCall(name, arguments);
    }

    Part printAdd(const Expr &e)
    {
        vec_basic terms = e->get_args();
        std::vector<std::pair<Expr, Monomial>> ordered;
        for (const Expr &term : terms) ordered.emplace_back(term, monomialOf(term));
        std::map<const Basic *, std::string> keys;
        auto key = [&keys](const Expr &term) -> const std::string & {
            auto found = keys.find(term.get());
            if (found == keys.end()) found = keys.emplace(term.get(), term->__str__()).first;
            return found->second;
        };
        std::stable_sort(ordered.begin(), ordered.end(), [&key](const auto &a, const auto &b) {
            const int rankA = termRank(a.second);
            const int rankB = termRank(b.second);
            if (rankA != rankB) return rankA < rankB;
            if (rankA == 0) {
                if (a.second.degree != b.second.degree) return a.second.degree > b.second.degree;
                //The same degree: lexicographic, the higher powers of the first variables first (x^2 + xy + y^2)
                std::set<std::string> variables;
                for (const auto &[name, power] : a.second.exponents) variables.insert(name);
                for (const auto &[name, power] : b.second.exponents) variables.insert(name);
                for (const std::string &name : variables) {
                    const auto foundA = a.second.exponents.find(name);
                    const auto foundB = b.second.exponents.find(name);
                    const long powerA = foundA == a.second.exponents.end() ? 0 : foundA->second;
                    const long powerB = foundB == b.second.exponents.end() ? 0 : foundB->second;
                    if (powerA != powerB) return powerA > powerB;
                }
            }
            return key(a.first) < key(b.first);
        });
        std::string text;
        for (size_t i = 0; i < ordered.size(); i++) {
            const Expr &term = ordered[i].first;
            const bool negative = isNegative(term);
            Part part = print(negative && i > 0 ? neg(term) : term);
            if (part.precedence <= ADD) part = parenthesized(part);
            if (i == 0) text = part.text;
            else text += (negative ? " - " : " + ") + part.text;
        }
        return {text, ADD, Lead::Other, false, false};
    }

    Factors factorsOf(const Mul &product) const
    {
        Factors factors{product.get_coef(), {}, {}};
        for (const auto &[base, exponent] : product.get_dict()) {
            if (is_a_Number(*exponent) && down_cast<const Number &>(*exponent).is_negative()) {
                Expr positive = neg(exponent);
                factors.denominator.push_back(eq(*positive, *one) ? base : Expr(make_rcp<const Pow>(base, positive)));
            } else {
                factors.numerator.push_back(eq(*exponent, *one) ? base : Expr(make_rcp<const Pow>(base, exponent)));
            }
        }
        auto byRank = [](const Expr &a, const Expr &b) {
            const int rankA = factorRank(a);
            const int rankB = factorRank(b);
            if (rankA != rankB) return rankA < rankB;
            return factorKey(a) < factorKey(b);
        };
        std::stable_sort(factors.numerator.begin(), factors.numerator.end(), byRank);
        std::stable_sort(factors.denominator.begin(), factors.denominator.end(), byRank);
        return factors;
    }

    //The product of parts: implicit after a number before a letter or a parenthesis, and between parentheses (2x,
    //2sin(x), 2(x + 1), (x - 2)(x - 3)); a * otherwise (x*y: xy is one name)
    std::string join(const std::vector<Part> &parts, bool bare = false) const
    {
        //A single part alone in a fraction of LaTeX needs no parentheses
        if (bare && parts.size() == 1) return parts[0].text;
        std::string text;
        for (size_t i = 0; i < parts.size(); i++) {
            Part part = parts[i].precedence < MUL ? parenthesized(parts[i]) : parts[i];
            if (i == 0) {
                text = part.text;
                continue;
            }
            const Part &previous = parts[i - 1];
            const bool afterNumber = previous.lead == Lead::Digit && previous.precedence == ATOM && !previous.endsWithI;
            bool implicit = (afterNumber && (part.lead == Lead::Letter || part.lead == Lead::Paren))
                || ((previous.endsWithParen || previous.precedence < MUL) && part.lead == Lead::Paren);
            if (tex_) text += implicit || part.lead != Lead::Digit ? " " : " \\cdot ";
            else text += implicit ? "" : "*";
            text += part.text;
        }
        return text;
    }

    Part printMul(const Expr &e)
    {
        const Factors factors = factorsOf(down_cast<const Mul &>(*e));
        RCP<const Number> coefficient = factors.coefficient;
        std::string sign;
        if (isNegativeNumber(*coefficient)) {
            sign = "-";
            coefficient = coefficient->mul(*minus_one);
        }
        std::vector<Part> numerator;
        std::vector<Part> denominator;
        if (is_a<Rational>(*coefficient)) {
            const Rational &value = down_cast<const Rational &>(*coefficient);
            numerator.push_back(print(integer(get_num(value.as_rational_class()))));
            denominator.push_back(print(integer(get_den(value.as_rational_class()))));
        } else if (!eq(*coefficient, *one)) {
            numerator.push_back(print(coefficient));
        }
        if (numerator.size() == 1 && numerator[0].text == "1" && !factors.numerator.empty()) numerator.clear();
        for (const Expr &factor : factors.numerator) numerator.push_back(print(factor));
        for (const Expr &factor : factors.denominator) denominator.push_back(print(factor));
        std::string top = numerator.empty() ? "1" : join(numerator, tex_);
        if (denominator.empty()) {
            const Lead lead = sign.empty() && !numerator.empty() ? numerator[0].lead : Lead::Other;
            return {sign + top, MUL, lead, numerator.size() == 1 && numerator[0].endsWithParen, false};
        }
        std::string bottom = join(denominator, tex_);
        if (tex_) return {sign + "\\frac{" + top + "}{" + bottom + "}", MUL, Lead::Other, false, false};
        //A single factor below needs no parentheses of its own: a sum is already in its own (join)
        const bool single = denominator.size() == 1 && (denominator[0].precedence >= POW || denominator[0].precedence < MUL);
        return {sign + top + "/" + (single ? bottom : paren(bottom)), MUL, sign.empty() && !numerator.empty() ? numerator[0].lead : Lead::Other, false, false};
    }

    Part printPow(const Expr &e)
    {
        const Pow &power = down_cast<const Pow &>(*e);
        const Expr base = power.get_base();
        const Expr exponent = power.get_exp();
        //A negative exponent alone: 1/x^2
        if (is_a_Number(*exponent) && down_cast<const Number &>(*exponent).is_negative()) {
            Expr positive = neg(exponent);
            Part bottom = print(eq(*positive, *one) ? base : Expr(make_rcp<const Pow>(base, positive)));
            if (tex_) return {"\\frac{1}{" + bottom.text + "}", MUL, Lead::Other, false, false};
            return {"1/" + (bottom.precedence >= POW ? bottom.text : paren(bottom.text)), MUL, Lead::Digit, false, false};
        }
        if (eq(*exponent, *rational(1, 2))) {
            Part inner = print(base);
            if (tex_) return {"\\sqrt{" + inner.text + "}", ATOM, Lead::Other, false, false};
            return {"sqrt(" + inner.text + ")", ATOM, Lead::Letter, true, false};
        }
        if (tex_ && is_a<Rational>(*exponent) && get_num(down_cast<const Rational &>(*exponent).as_rational_class()) == 1) {
            return {"\\sqrt[" + SymEngine::Integer(get_den(down_cast<const Rational &>(*exponent).as_rational_class())).__str__() + "]{" + print(base).text + "}", ATOM, Lead::Other, false, false};
        }
        Part bottom = print(base);
        const bool baseNeedsParen = bottom.precedence < ATOM || is_a<Pow>(*base) || bottom.text[0] == '-';
        if (baseNeedsParen) bottom = parenthesized(bottom);
        Part top = print(exponent);
        if (tex_) return {bottom.text + "^{" + top.text + "}", POW, bottom.lead, false, false};
        const bool simple = (is_a<Integer>(*exponent) && !down_cast<const Integer &>(*exponent).is_negative()) || is_a<Symbol>(*exponent)
            || is_a<Constant>(*exponent) || (top.precedence == ATOM && top.endsWithParen && top.lead == Lead::Letter);
        return {bottom.text + "^" + (simple ? top.text : paren(top.text)), POW, bottom.lead, simple && top.endsWithParen, false};
    }
};

}

std::string toText(const Expr &expression)
{
    return Printer(false).print(expression).text;
}

std::string toTeX(const Expr &expression)
{
    return Printer(true).print(expression).text;
}

}
