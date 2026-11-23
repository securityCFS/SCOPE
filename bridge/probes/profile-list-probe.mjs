/** Remote probe, kept independent of HTTP and local mutable state. */
export const PROFILE_LIST_PROBE = String.raw`
import hashlib
import ast
import base64
import json
import os

root = os.path.expanduser("~/.codex/scope-auth-profiles")
default_auth = os.path.expanduser("~/.codex/auth.json")
marker_slug = ""
try:
    with open(os.path.join(root, "active"), "r", encoding="utf-8") as handle:
        marker_slug = handle.read().strip()
except Exception:
    pass

def digest(path):
    try:
        with open(path, "rb") as handle:
            return hashlib.sha256(handle.read()).hexdigest()
    except Exception:
        return ""

default_digest = digest(default_auth)

def current_account(path):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception:
        return None
    tokens = data.get("tokens") if isinstance(data.get("tokens"), dict) else {}
    candidates = [tokens.get("id_token"), data.get("id_token"), tokens.get("access_token")]
    claims = {}
    for token in candidates:
        if not isinstance(token, str) or token.count(".") < 2:
            continue
        try:
            segment = token.split(".")[1]
            segment += "=" * (-len(segment) % 4)
            claims = json.loads(base64.urlsafe_b64decode(segment).decode("utf-8"))
            break
        except Exception:
            continue
    auth_claims = claims.get("https://api.openai.com/auth")
    if not isinstance(auth_claims, dict):
        auth_claims = {}
    email = claims.get("email") or auth_claims.get("email") or ""
    plan = (
        auth_claims.get("chatgpt_plan_type")
        or claims.get("chatgpt_plan_type")
        or claims.get("plan_type")
        or "unknown"
    )
    mode = str(data.get("auth_mode") or "chatgpt").lower()
    account_type = "apiKey" if "api" in mode and "chatgpt" not in mode else "chatgpt"
    return {
        "type": account_type,
        "email": str(email)[:320],
        "planType": str(plan)[:80],
    }

def safe_account(value):
    if not isinstance(value, dict):
        return None
    account_type = str(value.get("type") or "")[:40]
    if account_type not in ("chatgpt", "apiKey", "amazonBedrock"):
        return None
    return {
        "type": account_type,
        "email": str(value.get("email") or "")[:320],
        "planType": str(value.get("planType") or "")[:80],
    }

profiles = []
if os.path.isdir(root):
    for slug in sorted(os.listdir(root)):
        directory = os.path.join(root, slug)
        if not os.path.isdir(directory):
            continue
        auth_path = os.path.join(directory, "home", "auth.json")
        metadata_path = os.path.join(directory, "metadata.json")
        metadata = {}
        try:
            with open(metadata_path, "r", encoding="utf-8") as handle:
                metadata = json.load(handle)
        except Exception:
            pass
        profile_digest = digest(auth_path)
        profiles.append({
            "slug": slug,
            "name": str(metadata.get("name") or slug)[:80],
            "createdAt": metadata.get("createdAt"),
            "updatedAt": metadata.get("updatedAt"),
            "account": current_account(auth_path) or safe_account(metadata.get("account")),
            "ready": bool(profile_digest),
            "active": False,
            "matchesDefault": bool(default_digest and profile_digest == default_digest),
        })

ready_slugs = {item["slug"] for item in profiles if item["ready"]}
matching_slugs = [item["slug"] for item in profiles if item["matchesDefault"]]
active_slug = marker_slug if marker_slug in ready_slugs else ""
if not active_slug and len(matching_slugs) == 1:
    active_slug = matching_slugs[0]
for item in profiles:
    item["active"] = item["slug"] == active_slug
    item.pop("matchesDefault", None)

print(json.dumps({
    "profiles": profiles,
    "defaultAuthPresent": bool(default_digest),
    "activeProfile": active_slug or None,
    "currentAccount": current_account(default_auth) if default_digest else None,
}, ensure_ascii=False, separators=(",", ":")))
`;
