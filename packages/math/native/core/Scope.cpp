#include "Scope.h"

#include <set>
#include <symengine/symbol.h>

namespace math {

namespace {

//A signature: f(x, y) is the function f of the parameters x and y, g the constant g
struct Signature {
    std::string name;
    std::vector<std::string> parameters;
    bool function;
};

std::string trim(const std::string &text)
{
    const size_t first = text.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return "";
    return text.substr(first, text.find_last_not_of(" \t\r\n") - first + 1);
}

Signature signatureOf(const std::string &text)
{
    const std::string signature = trim(text);
    const size_t open = signature.find('(');
    Signature parsed{trim(signature.substr(0, open)), {}, open != std::string::npos};
    if (!isName(parsed.name)) throw MathError(ErrorCode::Definition, "The definition " + signature + ": " + parsed.name + " is not a name");
    if (isBuiltin(parsed.name)) throw MathError(ErrorCode::Definition, "The definition " + signature + ": " + parsed.name + " is a function or a constant of the formulas");
    if (!parsed.function) return parsed;
    if (signature.back() != ')') throw MathError(ErrorCode::Definition, "The definition " + signature + ": ) expected at its end");
    std::string list = signature.substr(open + 1, signature.size() - open - 2);
    std::set<std::string> seen;
    size_t start = 0;
    while (true) {
        const size_t comma = list.find(',', start);
        const std::string parameter = trim(list.substr(start, comma == std::string::npos ? std::string::npos : comma - start));
        if (!isName(parameter) || isBuiltin(parameter)) throw MathError(ErrorCode::Definition, "The definition " + signature + ": " + (parameter.empty() ? "a parameter is missing" : parameter + " cannot be a parameter"));
        if (!seen.insert(parameter).second) throw MathError(ErrorCode::Definition, "The definition " + signature + ": the parameter " + parameter + " is given twice");
        parsed.parameters.push_back(parameter);
        if (comma == std::string::npos) break;
        start = comma + 1;
    }
    return parsed;
}

}

std::shared_ptr<const Scope> Scope::make(std::shared_ptr<const Scope> parent, const std::vector<std::pair<std::string, std::string>> &definitions)
{
    auto scope = std::make_shared<Scope>();
    scope->parent_ = std::move(parent);
    scope->signatures_ = definitions;
    std::map<std::string, std::pair<Signature, std::string>> pending;
    for (const auto &[signature, body] : definitions) {
        Signature parsed = signatureOf(signature);
        const std::string name = parsed.name;
        if (pending.count(name)) throw MathError(ErrorCode::Definition, name + " is defined twice");
        pending.emplace(name, std::make_pair(std::move(parsed), body));
    }
    //Compiled when first needed, so that a definition can use another one written after it; the ones being compiled
    //tell a cycle
    std::vector<std::string> compiling;
    std::function<const Definition *(const std::string &)> compile = [&](const std::string &name) -> const Definition * {
        const auto done = scope->definitions_.find(name);
        if (done != scope->definitions_.end()) return &done->second;
        const auto waiting = pending.find(name);
        if (waiting == pending.end()) return scope->parent_ ? scope->parent_->find(name) : nullptr;
        for (const std::string &active : compiling) {
            if (active != name) continue;
            std::string cycle;
            for (const std::string &step : compiling) cycle += step + " → ";
            throw MathError(ErrorCode::Definition, "The definitions refer to each other in a cycle: " + cycle + name);
        }
        compiling.push_back(name);
        const Signature &signature = waiting->second.first;
        Definition definition;
        definition.function = signature.function;
        std::map<std::string, Definition> parameters;
        for (const std::string &parameter : signature.parameters) {
            Expr symbol = SymEngine::symbol(parameter);
            definition.parameters.push_back(symbol);
            parameters[parameter] = Definition{{}, symbol, false};
        }
        //In the body, the parameters hide the definitions of the same names
        Resolver resolver = [&](const std::string &used) -> const Definition * {
            const auto parameter = parameters.find(used);
            return parameter != parameters.end() ? &parameter->second : compile(used);
        };
        try {
            definition.body = parseExpression(waiting->second.second, resolver);
        } catch (const MathError &error) {
            if (error.code() == ErrorCode::Definition) throw;
            throw MathError(error.code() == ErrorCode::UnknownFunction ? ErrorCode::UnknownFunction : ErrorCode::Definition,
                "The definition of " + name + ": " + error.what(), error.position());
        }
        compiling.pop_back();
        return &scope->definitions_.emplace(name, std::move(definition)).first->second;
    };
    for (const auto &[name, entry] : pending) compile(name);
    return scope;
}

const Definition *Scope::find(const std::string &name) const
{
    const auto found = definitions_.find(name);
    if (found != definitions_.end()) return &found->second;
    return parent_ ? parent_->find(name) : nullptr;
}

Resolver Scope::resolver() const
{
    return [this](const std::string &name) { return find(name); };
}

const std::vector<std::pair<std::string, std::string>> &Scope::signatures() const
{
    return signatures_;
}

}
