"""Flat ACP elicitation schemas. Unknown shapes fail closed, never discard fields."""
import math

def options(field):
    if isinstance(field.get("enum"), list):
        labels = field.get("enumNames", field["enum"])
        return [{"value": str(v), "label": str(labels[i]) if i < len(labels) else str(v)} for i, v in enumerate(field["enum"])]
    variants = field.get("oneOf", field.get("anyOf", []))
    return [{"value": str(v["const"]), "label": v.get("title", str(v["const"]))} for v in variants if "const" in v]

def fields(schema):
    if schema.get("type") != "object" or not isinstance(schema.get("properties"), dict):
        raise ValueError("仅支持平面表单")
    result = []
    for name, field in schema["properties"].items():
        kind = field.get("type", "string" if options(field) else None)
        if kind not in ("string", "number", "integer", "boolean", "array"):
            raise ValueError("不支持的表单字段: " + name)
        choices = options(field.get("items", {})) if kind == "array" else options(field)
        if kind == "array" and not choices: raise ValueError("仅支持枚举多选: " + name)
        result.append({**field, "name": name, "title": field.get("title", name), "type": kind,
                       "required": name in schema.get("required", []), "options": choices})
    return result

def validate(schema, content):
    if not isinstance(content, dict): raise ValueError("表单回答格式无效")
    definitions = fields(schema)
    if set(content) - {f["name"] for f in definitions}: raise ValueError("表单包含未知字段")
    for f in definitions:
        name = f["name"]
        if name not in content:
            if f["required"]: raise ValueError("请填写 " + f["title"])
            continue
        v, kind = content[name], f["type"]
        if kind == "string":
            if not isinstance(v, str): raise ValueError("需要文本: " + name)
            if len(v) < f.get("minLength", 0) or len(v) > f.get("maxLength", 10000): raise ValueError("文本长度无效: " + name)
        elif kind == "boolean":
            if not isinstance(v, bool): raise ValueError("需要是或否: " + name)
        elif kind in ("number", "integer"):
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v): raise ValueError("需要数字: " + name)
            if kind == "integer" and int(v) != v: raise ValueError("需要整数: " + name)
            if v < f.get("minimum", -math.inf) or v > f.get("maximum", math.inf): raise ValueError("数字超出范围: " + name)
        elif kind == "array":
            if not isinstance(v, list) or any(not isinstance(x, str) for x in v): raise ValueError("需要多选数组: " + name)
            if len(set(v)) != len(v) or len(v) < f.get("minItems", 0) or len(v) > f.get("maxItems", 100): raise ValueError("选择数量无效: " + name)
        if f["options"] and any(str(x) not in {o["value"] for o in f["options"]} for x in (v if kind == "array" else [v])):
            raise ValueError("选项已失效: " + name)
    return content
