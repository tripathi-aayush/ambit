"""Tree-sitter based extraction of functions, classes, imports, and a
best-effort guess at API routes (FastAPI/Flask-style Python decorators,
Express-style JS/TS calls). Phase 2 scope: Python, JavaScript, TypeScript.
"""

from dataclasses import dataclass

from tree_sitter import Node
from tree_sitter_language_pack import get_parser

ROUTE_VERBS = {"get", "post", "put", "patch", "delete"}


@dataclass
class SymbolResult:
    symbol_type: str  # function | class | import | route
    name: str
    detail: str | None
    start_line: int
    end_line: int


def _text(node: Node, src: bytes) -> str:
    return src[node.start_byte : node.end_byte].decode("utf-8", errors="replace")


def _lines(node: Node) -> tuple[int, int]:
    return node.start_point[0] + 1, node.end_point[0] + 1


def _string_literal_value(node: Node, src: bytes) -> str | None:
    """Best-effort extraction of the literal text inside a string node,
    across the Python (string_content) and JS/TS (string_fragment) grammars."""
    if node.type != "string":
        return None
    for child in node.children:
        if child.type in ("string_content", "string_fragment"):
            return _text(child, src)
    # Empty string literal ("") has start/end quote tokens but no content child.
    if any(c.type in ("string_start", '"', "'") for c in node.children):
        return ""
    return None


def _find_string_arg(argument_list: Node, src: bytes) -> str | None:
    for child in argument_list.children:
        value = _string_literal_value(child, src)
        if value is not None:
            return value
    return None


def _parse_python(root: Node, src: bytes) -> list[SymbolResult]:
    results: list[SymbolResult] = []

    def visit(node: Node) -> None:
        if node.type == "function_definition":
            name_node = node.child_by_field_name("name")
            if name_node:
                s, e = _lines(node)
                results.append(SymbolResult("function", _text(name_node, src), None, s, e))
        elif node.type == "class_definition":
            name_node = node.child_by_field_name("name")
            if name_node:
                s, e = _lines(node)
                results.append(SymbolResult("class", _text(name_node, src), None, s, e))
        elif node.type == "import_from_statement":
            module = node.child_by_field_name("module_name")
            detail = _text(module, src) if module else None
            s, e = _lines(node)
            results.append(SymbolResult("import", _text(node, src).strip(), detail, s, e))
        elif node.type == "import_statement":
            modules = []
            for c in node.children:
                if c.type == "dotted_name":
                    modules.append(_text(c, src))
                elif c.type == "aliased_import":
                    name_node = c.child_by_field_name("name")
                    if name_node:
                        modules.append(_text(name_node, src))
            detail = ",".join(modules) if modules else None
            s, e = _lines(node)
            results.append(SymbolResult("import", _text(node, src).strip(), detail, s, e))
        elif node.type == "decorated_definition":
            route = _python_route(node, src)
            if route:
                results.append(route)

        for child in node.children:
            visit(child)

    visit(root)
    return results


def _python_route(decorated: Node, src: bytes) -> SymbolResult | None:
    fn_node = next((c for c in decorated.children if c.type == "function_definition"), None)
    if fn_node is None:
        return None

    for decorator in decorated.children:
        if decorator.type != "decorator":
            continue
        call = next((c for c in decorator.children if c.type == "call"), None)
        if call is None:
            continue
        attribute = call.child_by_field_name("function")
        if attribute is None or attribute.type != "attribute":
            continue
        verb_node = attribute.child_by_field_name("attribute")
        if verb_node is None or _text(verb_node, src) not in ROUTE_VERBS:
            continue
        args = call.child_by_field_name("arguments")
        path = _find_string_arg(args, src) if args else None
        if path is None:
            continue
        s, e = _lines(fn_node)
        return SymbolResult("route", f"{_text(verb_node, src).upper()} {path}", None, s, e)
    return None


def _parse_javascript(root: Node, src: bytes) -> list[SymbolResult]:
    results: list[SymbolResult] = []

    def visit(node: Node) -> None:
        if node.type == "function_declaration":
            name_node = node.child_by_field_name("name")
            if name_node:
                s, e = _lines(node)
                results.append(SymbolResult("function", _text(name_node, src), None, s, e))
        elif node.type == "class_declaration":
            name_node = node.child_by_field_name("name")
            if name_node:
                s, e = _lines(node)
                results.append(SymbolResult("class", _text(name_node, src), None, s, e))
        elif node.type == "import_statement":
            source = node.child_by_field_name("source")
            detail = _string_literal_value(source, src) if source else None
            s, e = _lines(node)
            results.append(SymbolResult("import", _text(node, src).strip(), detail, s, e))
        elif node.type == "variable_declarator":
            value = node.child_by_field_name("value")
            name_node = node.child_by_field_name("name")
            if value is not None and value.type == "arrow_function" and name_node is not None:
                s, e = _lines(node)
                results.append(SymbolResult("function", _text(name_node, src), None, s, e))
        elif node.type == "call_expression":
            route = _js_route(node, src)
            if route:
                results.append(route)

        for child in node.children:
            visit(child)

    visit(root)
    return results


def _js_route(call: Node, src: bytes) -> SymbolResult | None:
    fn = call.child_by_field_name("function")
    if fn is None or fn.type != "member_expression":
        return None
    prop = fn.child_by_field_name("property")
    if prop is None or _text(prop, src) not in ROUTE_VERBS:
        return None
    args = call.child_by_field_name("arguments")
    path = _find_string_arg(args, src) if args else None
    if path is None:
        return None
    s, e = _lines(call)
    return SymbolResult("route", f"{_text(prop, src).upper()} {path}", None, s, e)


_PARSERS = {
    "python": _parse_python,
    "javascript": _parse_javascript,
    "typescript": _parse_javascript,
}


def parse_symbols(language: str, content: str) -> list[SymbolResult]:
    handler = _PARSERS.get(language)
    if handler is None:
        return []
    src = content.encode("utf-8")
    tree = get_parser(language).parse(src)
    return handler(tree.root_node, src)
