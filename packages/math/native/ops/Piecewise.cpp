//The piecewise expressions (see Piecewise.h)
#include "Piecewise.h"

#include <algorithm>
#include <cmath>
#include <complex>

#include <symengine/constants.h>
#include <symengine/eval_double.h>
#include <symengine/subs.h>
#include <symengine/visitor.h>

#include "../core/Errors.h"
#include "../printer/Printer.h"
#include "Operations.h"

namespace math {

using namespace SymEngine;

namespace {

//The piecewise parts of an expression, the outer ones (those inside them are reached through them)
void piecewiseParts(const Expr &expression, std::vector<Expr> &parts)
{
    if (is_a<Piecewise>(*expression)) {
        parts.push_back(expression);
        return;
    }
    for (const Expr &argument : expression->get_args()) piecewiseParts(argument, parts);
}

//The comparisons of the conditions of the piecewise parts, also nested
void comparisons(const Expr &expression, std::vector<RCP<const Relational>> &found)
{
    if (is_a_Relational(*expression)) found.push_back(rcp_static_cast<const Relational>(expression));
    for (const Expr &argument : expression->get_args()) comparisons(argument, found);
}

//A condition with its comparisons of constants decided
RCP<const Boolean> conditionDecided(const RCP<const Boolean> &condition)
{
    const int known = decidedOf(condition);
    if (known == 1) return boolTrue;
    if (known == 0) return boolFalse;
    if (is_a<And>(*condition) || is_a<Or>(*condition)) {
        set_boolean parts;
        const set_boolean &container = is_a<And>(*condition) ? down_cast<const And &>(*condition).get_container() : down_cast<const Or &>(*condition).get_container();
        for (const RCP<const Boolean> &part : container) parts.insert(conditionDecided(part));
        return is_a<And>(*condition) ? logical_and(parts) : logical_or(parts);
    }
    if (is_a<Not>(*condition)) return logical_not(conditionDecided(down_cast<const Not &>(*condition).get_arg()));
    return condition;
}

}

RCP<const Boolean> relationOf(const std::string &relation, const Expr &a, const Expr &b)
{
    try {
        if (relation == "<") return Lt(a, b);
        if (relation == "<=") return Le(a, b);
        if (relation == ">") return Gt(a, b);
        if (relation == ">=") return Ge(a, b);
        if (relation == "=") return Eq(a, b);
        if (relation == "!=") return Ne(a, b);
    } catch (SymEngineException &) {
        throw MathError(ErrorCode::Domain, toText(a) + " " + relation + " " + toText(b) + " compares values that are not real");
    }
    throw MathError(ErrorCode::Argument, "Not a comparison: " + relation);
}

int decidedOf(const RCP<const Boolean> &condition)
{
    if (is_a<BooleanAtom>(*condition)) return down_cast<const BooleanAtom &>(*condition).get_val() ? 1 : 0;
    if (is_a_Relational(*condition)) {
        const Relational &relation = down_cast<const Relational &>(*condition);
        const Expr &a = relation.get_arg1(), &b = relation.get_arg2();
        if (!free_symbols(*a).empty() || !free_symbols(*b).empty()) return -1;
        const int order = compareOf(a, b);
        if (order == 2) return -1;
        if (is_a<Equality>(relation)) return order == 0 ? 1 : 0;
        if (is_a<Unequality>(relation)) return order == 0 ? 0 : 1;
        if (is_a<StrictLessThan>(relation)) return order < 0 ? 1 : 0;
        if (is_a<LessThan>(relation)) return order <= 0 ? 1 : 0;
        return -1;
    }
    if (is_a<And>(*condition) || is_a<Or>(*condition)) {
        const bool both = is_a<And>(*condition);
        const set_boolean &container = both ? down_cast<const And &>(*condition).get_container() : down_cast<const Or &>(*condition).get_container();
        bool unknown = false;
        for (const RCP<const Boolean> &part : container) {
            const int known = decidedOf(part);
            if (known == (both ? 0 : 1)) return known;
            if (known == -1) unknown = true;
        }
        return unknown ? -1 : (both ? 1 : 0);
    }
    if (is_a<Not>(*condition)) {
        const int known = decidedOf(down_cast<const Not &>(*condition).get_arg());
        return known == -1 ? -1 : 1 - known;
    }
    return -1;
}

Expr settledOf(const Expr &expression)
{
    const Piecewise &piecewise = down_cast<const Piecewise &>(*expression);
    PiecewiseVec cases;
    bool changed = false;
    for (const auto &[value, condition] : piecewise.get_vec()) {
        const RCP<const Boolean> decided = conditionDecided(condition);
        changed = changed || !eq(*decided, *condition);
        cases.emplace_back(value, decided);
    }
    return changed ? mergedOf(SymEngine::piecewise(cases)) : expression;
}

Expr mergedOf(const Expr &expression)
{
    std::vector<Expr> parts;
    piecewiseParts(expression, parts);
    if (parts.empty()) return expression;
    map_basic_basic replacements;
    for (const Expr &part : parts) {
        PiecewiseVec cases;
        for (const auto &[value, condition] : down_cast<const Piecewise &>(*part).get_vec()) {
            const Expr inner = mergedOf(value);
            if (!cases.empty() && eq(*cases.back().first, *inner)) {
                cases.back().second = eq(*condition, *boolTrue) ? RCP<const Boolean>(boolTrue) : logical_or({cases.back().second, condition});
            } else {
                cases.emplace_back(inner, condition);
            }
        }
        //A case of the value where no other case holds is that case
        while (cases.size() > 1 && eq(*cases.back().second, *boolTrue) && eq(*cases[cases.size() - 2].first, *cases.back().first)) cases.erase(cases.end() - 2);
        const Expr merged = SymEngine::piecewise(cases);
        if (!eq(*merged, *part)) replacements[part] = merged;
    }
    return replacements.empty() ? expression : xreplace(expression, replacements);
}

Expr caseOf(const Basic &piecewise)
{
    for (const auto &[value, condition] : down_cast<const Piecewise &>(piecewise).get_vec()) {
        const int known = decidedOf(condition);
        if (known == 1) return value;
        if (known == -1) throw MathError(ErrorCode::NotSupported, "The condition " + toText(condition) + " of " + toText(piecewise.rcp_from_this()) + " cannot be decided");
    }
    return Nan;
}

Expr withOtherwise(const Expr &expression)
{
    std::vector<Expr> parts;
    piecewiseParts(expression, parts);
    if (parts.empty()) return expression;
    map_basic_basic replacements;
    for (const Expr &part : parts) {
        PiecewiseVec cases;
        for (const auto &[value, condition] : down_cast<const Piecewise &>(*part).get_vec()) cases.emplace_back(withOtherwise(value), condition);
        if (!eq(*cases.back().second, *boolTrue)) cases.emplace_back(Nan, boolTrue);
        replacements[part] = make_rcp<const Piecewise>(std::move(cases));
    }
    return xreplace(expression, replacements);
}

std::vector<double> breakpointsOf(const Expr &expression, const std::string &variable)
{
    std::vector<Expr> parts;
    piecewiseParts(expression, parts);
    std::vector<RCP<const Relational>> found;
    for (const Expr &part : parts) {
        for (const auto &[value, condition] : down_cast<const Piecewise &>(*part).get_vec()) comparisons(condition, found);
    }
    std::vector<double> points;
    for (const RCP<const Relational> &relation : found) {
        try {
            const Solutions roots = solveOf(sub(relation->get_arg1(), relation->get_arg2()), variable, true);
            if (roots.kind != "finite") continue;
            for (const Expr &root : roots.values) {
                if (!variablesOf(root).empty()) continue;
                const std::complex<double> value = toComplex(root);
                if (value.imag() == 0 && std::isfinite(value.real())) points.push_back(value.real());
            }
        } catch (const MathError &error) {
            if (error.code() == ErrorCode::Cancelled || error.code() == ErrorCode::Timeout) throw;
        }
    }
    std::sort(points.begin(), points.end());
    points.erase(std::unique(points.begin(), points.end()), points.end());
    return points;
}

}
