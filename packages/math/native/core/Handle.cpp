#include "Handle.h"

#include <algorithm>
#include <unordered_map>

#include <symengine/add.h>
#include <symengine/constants.h>
#include <symengine/mul.h>
#include <symengine/pow.h>

#include "Errors.h"

namespace math {

//Random 128-bit tags, one by type of handle
const napi_type_tag EXPRESSION_TAG = {0x6c616b7574617461ULL, 0x6d61746845787072ULL};
const napi_type_tag SCOPE_TAG = {0x6c616b7574617461ULL, 0x6d61746853636f70ULL};
const napi_type_tag COMPILED_TAG = {0x6c616b7574617461ULL, 0x6d617468436f6d70ULL};
const napi_type_tag TOKEN_TAG = {0x6c616b7574617461ULL, 0x6d617468546f6b6eULL};

void childrenOf(const SymEngine::Basic &node, std::vector<const SymEngine::Basic *> &children)
{
    children.clear();
    if (SymEngine::is_a_Number(node) || SymEngine::is_a<SymEngine::Symbol>(node) || SymEngine::is_a<SymEngine::Constant>(node)) return;
    if (SymEngine::is_a<SymEngine::Add>(node)) {
        for (const auto &[term, coefficient] : SymEngine::down_cast<const SymEngine::Add &>(node).get_dict()) children.push_back(term.get());
    } else if (SymEngine::is_a<SymEngine::Mul>(node)) {
        for (const auto &[base, exponent] : SymEngine::down_cast<const SymEngine::Mul &>(node).get_dict()) {
            children.push_back(base.get());
            if (!SymEngine::is_a_Number(*exponent)) children.push_back(exponent.get());
        }
    } else if (SymEngine::is_a<SymEngine::Pow>(node)) {
        children.push_back(SymEngine::down_cast<const SymEngine::Pow &>(node).get_base().get());
        children.push_back(SymEngine::down_cast<const SymEngine::Pow &>(node).get_exp().get());
    } else {
        for (const Expr &argument : node.get_args()) children.push_back(argument.get());
    }
}

size_t expressionMemory(const Expr &expression)
{
    //The node and its children: a cheap estimate, deep enough for the sums and the products of many terms
    std::vector<const SymEngine::Basic *> children, grandchildren;
    childrenOf(*expression, children);
    size_t memory = 96;
    for (const SymEngine::Basic *child : children) {
        childrenOf(*child, grandchildren);
        memory += 96 + 32 * grandchildren.size();
    }
    return memory;
}

void checkDepth(const Expr &expression)
{
    //Without recursion, the height of each subexpression with children computed once (the expression is a graph)
    struct Frame {
        const SymEngine::Basic *node;
        std::vector<const SymEngine::Basic *> children;
        size_t next;
        unsigned height;
    };
    std::unordered_map<const SymEngine::Basic *, unsigned> heights;
    std::vector<Frame> path;
    const auto deeper = [&path](unsigned below) {
        if (path.size() + below > MAX_DEPTH) throw MathError(ErrorCode::NotSupported, "The expression is nested more than " + std::to_string(MAX_DEPTH) + " levels deep");
    };
    std::vector<const SymEngine::Basic *> children;
    childrenOf(*expression, children);
    if (children.empty()) return;
    path.push_back({expression.get(), children, 0, 0});
    while (!path.empty()) {
        Frame &frame = path.back();
        if (frame.next == frame.children.size()) {
            const unsigned height = frame.height;
            heights.emplace(frame.node, height);
            path.pop_back();
            if (!path.empty()) path.back().height = std::max(path.back().height, height + 1);
            continue;
        }
        const SymEngine::Basic *child = frame.children[frame.next++];
        const auto known = heights.find(child);
        if (known != heights.end()) {
            deeper(known->second + 1);
            frame.height = std::max(frame.height, known->second + 1);
            continue;
        }
        childrenOf(*child, children);
        if (children.empty()) {
            frame.height = std::max(frame.height, 1u);
            continue;
        }
        deeper(1);
        path.push_back({child, children, 0, 0});
    }
}

Napi::Value wrapExpression(Napi::Env env, const Expr &expression)
{
    checkDepth(expression);
    return wrap(env, std::make_shared<Expr>(expression), EXPRESSION_TAG, static_cast<int64_t>(expressionMemory(expression)));
}

Expr unwrapExpression(const Napi::Value &value)
{
    return *unwrap<Expr>(value, EXPRESSION_TAG, "an expression");
}

}
