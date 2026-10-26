"""Learning helpers (used by mapSite): JSON-LD fields, CSS rule validation, extras, finalisation."""

from __future__ import annotations

from typing import Any

from . import _dom
from ._js import iso_now, json_stringify, trim
from .apply import (
    apply_locator,
    apply_site_contract,
    ctx_for,
    extra_text,
    find_label_el,
    group_by_parent,
    nearest_heading,
)
from .doc import ParsedDoc, doc_of, sample_get
from .jsonld import (
    JSONLD_PATHS,
    classify_subject,
    extract_json_ld,
    json_ld_signature,
    to_raw,
    types_of,
)
from .keys import (
    EXTRA_PREFIX,
    KEYS_BY_SUBJECT,
    TAX_PREFIX,
    all_field_ids,
    field_type,
    is_alias,
    is_classifier,
    is_derived,
    is_empty_value,
    is_extra_id,
    is_identity_id,
    is_tax_id,
    key_of,
)
from .opts import kwargs_of, norm_opts
from .values import is_value_anchored, norm_val, validate_value

# Re-exported from values for callers of this module.
__all__ = ["norm_val"]


def firm_signatures_across(samples: list[Any]) -> set[str]:
    """JSON-LD objects identical on >= 2 sample pages are site-wide (firm)."""
    count: dict[str, int] = {}
    for s in samples:
        seen: set[str] = set()
        for o in doc_of(s).objs:
            sig = json_ld_signature(o)
            if not sig or sig in seen:
                continue
            seen.add(sig)
            count[sig] = count.get(sig, 0) + 1
    return {k for k, n in count.items() if n >= 2}


def build_json_ld_fields(
    samples: list[Any], primary: str, site_entity_names: set[str]
) -> dict[str, Any]:
    """JSON-LD tier fields; returns ``{fields, firmSignatures}``."""
    firm_signatures = firm_signatures_across(samples) if len(samples) >= 2 else set()
    opts = {"firm_signatures": firm_signatures}
    per_sample = [doc_of(s).objs for s in samples]
    fields: dict[str, Any] = {}
    subjects = ["person", "location", "firm"] if primary == "person" else ["location", "firm"]
    for subject in subjects:
        keys = KEYS_BY_SUBJECT[subject]
        for key, paths in JSONLD_PATHS[subject].items():
            type_ = keys[key]
            best: dict[str, Any] | None = None
            for path in paths:
                hits = 0
                types: list[str] = []
                for i, s in enumerate(samples):
                    for o in per_sample[i]:
                        if classify_subject(o, site_entity_names, opts) != subject:
                            continue
                        v = validate_value(type_, to_raw(type_, extract_json_ld(o, path)),
                                           sample_get(s, "url") or "", f"{subject}.{key}")
                        if v is not None:
                            hits += 1
                            for t in types_of(o):
                                if t not in types:
                                    types.append(t)
                            break
                if hits > 0 and (best is None or hits > best["hits"]):
                    best = {"path": path, "hits": hits, "types": types}
            if best:
                fields[f"{subject}.{key}"] = {
                    "tier": "jsonld",
                    "locator": {"tier": "jsonld", "subject": subject, "types": best["types"],
                                "path": best["path"]},
                    "type": type_,
                    "hits": best["hits"],
                    "samples": len(samples),
                }
    return {"fields": fields, "firmSignatures": firm_signatures}


def _rule_ok(x: dict[str, Any]) -> bool:
    return (x.get("strategy") == "css" and bool(x.get("css"))) or (
        x.get("strategy") == "label" and bool(x.get("label")))


def group_geo_rules(rules: list[Any], tax_types: dict[str, str]) -> list[dict[str, Any]]:
    """C9: merge per-coordinate rules on a geo key into one pair locator."""
    out: list[dict[str, Any]] = []
    parts: dict[str, dict[str, Any]] = {}
    for r in rules:
        if (isinstance(r, dict) and isinstance(r.get("id"), str)
                and tax_types.get(r["id"]) == "geo" and r.get("part") in ("latitude", "longitude")):
            g = parts.setdefault(r["id"], {})
            if not g.get(r["part"]):
                g[r["part"]] = r
            continue
        out.append({"r": r})
    for g in parts.values():
        lat, lng = g.get("latitude"), g.get("longitude")
        if not lat or not lng:
            out.append({"r": lat or lng})
            continue
        if not _rule_ok(lat) or not _rule_ok(lng):
            out.append({"r": lat})
            continue
        out.append({
            "r": lat,
            "pair": {"tier": "css", "strategy": "css",
                     "pair": {"latitude": rule_to_locator(lat), "longitude": rule_to_locator(lng)}},
        })
    return out


CHROME_TAGS = {"header", "nav", "footer", "aside"}
CHROME_ROLES = {"banner", "navigation", "contentinfo", "search"}


def in_chrome(soup: Any, el: Any) -> bool:
    """C9: element sits inside site chrome (and that chrome does not hold the page h1)."""
    h1 = _dom.select_first(soup, "h1")
    cur = el
    while cur is not None and _dom.is_tag(cur):
        tag = _dom.tag_name(cur)
        role = (_dom.attr(cur, "role") or "").lower()
        if tag in CHROME_TAGS or role in CHROME_ROLES or _dom.is_chrome_by_name(cur):
            if h1 is not None and (cur is h1 or _dom.contains(cur, h1)):
                cur = cur.parent
                continue
            return True
        cur = cur.parent
    return False


def locator_targets_chrome(soup: Any, loc: dict[str, Any]) -> bool:
    """C9: the element(s) a CSS/label locator reads all sit in site chrome."""
    try:
        pair = loc.get("pair")
        if pair:
            return (locator_targets_chrome(soup, pair["latitude"])
                    or locator_targets_chrome(soup, pair["longitude"]))
        if loc.get("strategy") == "css":
            if not loc.get("css"):
                return False
            els = _dom.select(soup, loc["css"])
            return len(els) > 0 and all(in_chrome(soup, el) for el in els)
        el = find_label_el(soup, loc.get("label") or "")
        return el is not None and in_chrome(soup, el)
    except Exception:  # noqa: BLE001 — TS catch-all
        return False


#: Sub-keys a structured entry rule may read.
ITEM_FIELD_KEYS = {"title", "year", "issuer", "description", "url", "school", "degree"}


def clean_item_fields(v: Any) -> dict[str, str] | None:
    if not isinstance(v, dict):
        return None
    out = {k: trim(css)[:200] for k, css in v.items()
           if k in ITEM_FIELD_KEYS and isinstance(css, str) and trim(css)}
    return out or None


def rule_to_locator(r: dict[str, Any]) -> dict[str, Any]:
    loc: dict[str, Any] = {"tier": "css", "strategy": r.get("strategy")}
    if r.get("css"):
        loc["css"] = r["css"]
    if r.get("label"):
        loc["label"] = r["label"]
    if r.get("attr"):
        loc["attr"] = r["attr"]
    if r.get("multi"):
        loc["multi"] = True
    if r.get("split_commas"):
        loc["split_commas"] = True
    itf = clean_item_fields(r.get("item_fields"))
    if itf:
        loc["item_fields"] = itf
    return loc


def count_distinct_fields(values: dict[str, Any]) -> int:
    """S4-1: distinct non-empty values over identity ids and 'tax.*'."""
    seen: set[str] = set()
    for fid, v in values.items():
        if is_extra_id(fid) or not (is_tax_id(fid) or is_identity_id(fid)):
            continue
        if is_empty_value(v):
            continue
        nv = norm_val(v)
        if nv != "":
            seen.add(nv)
    return len(seen)


def clashes(fid: str, v: Any, accepted: dict[str, Any]) -> bool:
    """Fix 2: a value identical to a DIFFERENT field's value on the same page is a miss."""
    nv = norm_val(v)
    if nv == "":
        return False
    key = key_of(fid)
    return any(oid != fid and not is_tax_id(oid) and key_of(oid) != key and ov is not None
               and norm_val(ov) == nv for oid, ov in accepted.items())


#: C8: universal keys that belong to the address type group for taxonomy clash checks.
ADDRESS_FAMILY = {"address_block", "street", "city", "state", "postal_code"}


def clashes_tax(type_: str, v: Any, accepted: dict[str, Any], fields: dict[str, Any]) -> bool:
    """A taxonomy value clashes with a universal field of a DIFFERENT value type."""
    nv = norm_val(v)
    if nv == "":
        return False
    for oid, ov in accepted.items():
        if is_tax_id(oid) or ov is None:
            continue
        ot = fields[oid].get("type") if oid in fields and fields[oid].get("type") is not None \
            else field_type(oid)
        if ot == type_:
            continue
        if type_ == "address" and key_of(oid) in ADDRESS_FAMILY:
            continue
        if norm_val(ov) == nv:
            return True
    return False


def merge_css_rules(
    fields: dict[str, Any],
    rules: list[Any],
    samples: list[Any],
    primary: str,
    site_entity_names: set[str],
    opts: dict[str, Any] | None = None,
    tax_types: dict[str, str] | None = None,
    tax_item_words: dict[str, list[str]] | None = None,
) -> dict[str, Any]:
    """Validate AI rules on every sample; returns ``{fields, failed, extraReasons, extraFound,
    rejected}``."""
    opts = norm_opts(opts)
    tax_types = tax_types or {}
    tax_item_words = tax_item_words or {}
    allowed = set(all_field_ids(primary)) | set(tax_types)
    rejected: dict[str, Any] = {}
    out = dict(fields)
    failed: dict[str, None] = {}
    passed: set[str] = set()
    extra_reasons: dict[str, str] = {}
    extra_found: dict[str, int] = {}
    ctxs = [ctx_for(doc_of(s), sample_get(s, "url") or "", site_entity_names, opts)
            for s in samples]
    accepted = [apply_site_contract(doc_of(s), sample_get(s, "url") or "", {"fields": out},
                                    site_entity_names, opts)["values"] for s in samples]
    for item in group_geo_rules(rules if isinstance(rules, list) else [], tax_types):
        r, pair = item.get("r"), item.get("pair")
        if not isinstance(r, dict) or not isinstance(r.get("id"), str) or r["id"] not in allowed:
            continue
        rid = r["id"]
        extra = is_extra_id(rid)

        def fail(reason: str | None = None, why: str = "incomplete_rule", found: int = 0,
                 _r: dict[str, Any] = r, _rid: str = rid, _extra: bool = extra) -> None:
            failed[_rid] = None
            if _extra and not extra_reasons.get(_rid):
                extra_reasons[_rid] = reason or "rule_failed_validation"
            # Fix (rejected rules kept, 2026-10-22): fixed fields keep the rejected rule.
            if not _extra and not is_tax_id(_rid):
                diag = {k: v for k, v in _r.items() if k != "id"}
                rejected[_rid] = {"rule": diag, "found": found, "samples": len(samples),
                                  "why": why}

        strategy = r.get("strategy")
        if strategy not in ("css", "label"):
            fail()
            continue
        if strategy == "css" and not r.get("css"):
            fail()
            continue
        if strategy == "label" and not r.get("label"):
            fail()
            continue
        # Fix 19: a label rule anchored on the site's own brand name is rejected.
        if strategy == "label":
            import re

            lab = re.sub(r":+\s*$", "", trim(str(r["label"])).lower(), count=1)
            if lab in site_entity_names:
                fail(None, "label_is_brand_name")
                continue
        tax = is_tax_id(rid) or extra
        type_ = tax_types.get(rid) if tax else field_type(rid)
        locator = pair if pair is not None else rule_to_locator(r)
        # C11: selecting by the text itself is not a structural rule.
        if is_value_anchored(locator):
            fail(None, "anchored_on_value")
            continue
        if tax and tax_item_words.get(rid) is not None:
            locator["item_words"] = tax_item_words[rid]
        # C9 / Fix (page-specific footer values, 2026-10-22): a rule into chrome is kept only when
        # its value differs between samples.
        chrome = False
        in_chrome_at: list[bool] = []
        vals: list[Any] = []
        for c in ctxs:
            sp = c.soup()
            in_chrome_at.append(sp is not None and locator_targets_chrome(sp, locator))
            vals.append(apply_locator(locator, type_, rid, c))
        if any(in_chrome_at):
            chrome_vals = {norm_val(v) for i, v in enumerate(vals)
                           if in_chrome_at[i] and v is not None}
            if len(chrome_vals) < 2:
                chrome = True
                vals = [None if in_chrome_at[i] else v for i, v in enumerate(vals)]

        def extra_clash(v: Any, acc: dict[str, Any]) -> bool:
            nv = norm_val(v)
            return nv != "" and any(
                not is_extra_id(oid) and (is_tax_id(oid) or is_identity_id(oid))
                and ov is not None and norm_val(ov) == nv for oid, ov in acc.items())

        found = sum(1 for v in vals if v is not None)
        if extra:
            extra_found[rid] = found

        def clash(v: Any, i: int, _rid: str = rid, _type: str | None = type_,
                  _extra: bool = extra, _tax: bool = tax) -> bool:
            if _extra:
                return extra_clash(v, accepted[i])
            if _tax:
                return clashes_tax(_type, v, accepted[i], out)
            return clashes(_rid, v, accepted[i])

        hits = sum(1 for i, v in enumerate(vals) if v is not None and not clash(v, i))
        if hits < 1 or is_value_anchored(locator, vals):
            fail(
                "chrome" if chrome and found == 0
                else "duplicate_value" if found > 0 and hits < 1 and extra
                else "rule_failed_validation",
                "site_chrome" if chrome and found == 0
                else "anchored_on_value" if hits >= 1
                else "clashes_with_other_field" if found > 0
                else "no_value_on_samples",
                found,
            )
            continue
        passed.add(rid)
        if extra:
            # Extras never enter `accepted`.
            if not out.get(rid):
                out[rid] = {"tier": "css", "locator": locator, "type": type_, "hits": hits,
                            "samples": len(samples)}
            continue
        existing = out.get(rid)
        if existing and is_derived(existing.get("locator")):
            # Fix 8: a direct rule wins over a derived one; the derived one becomes backup.
            out[rid] = {"tier": "css", "locator": locator, "type": type_, "hits": hits,
                        "samples": len(samples), "backup": existing["locator"]}
            for i, v in enumerate(vals):
                if v is not None:
                    accepted[i][rid] = v
            continue
        if existing:
            if ((existing.get("tier") == "jsonld" or existing.get("kept_from_previous"))
                    and not existing.get("backup")):
                # C10: a rule kept from the previous contract stays primary; new one is backup.
                out[rid] = {**existing, "backup": locator}
                for i, v in enumerate(vals):
                    if v is not None and accepted[i].get(rid) is None:
                        accepted[i][rid] = v
            continue
        out[rid] = {"tier": "css", "locator": locator, "type": type_, "hits": hits,
                    "samples": len(samples)}
        for i, v in enumerate(vals):
            if v is not None:
                accepted[i][rid] = v
    add_derived_address_fields(out, samples, site_entity_names, opts)
    for fid in passed:
        extra_reasons.pop(fid, None)
        rejected.pop(fid, None)
    return {
        "fields": out,
        "failed": [fid for fid in failed if fid not in passed],
        "extraReasons": extra_reasons,
        "extraFound": extra_found,
        "rejected": rejected,
    }


# ---------------------------------------------------------------------------
# C14: extra fields (staging only; ids 'extra.<key>')
# ---------------------------------------------------------------------------
EXTRA_FIELDS_CAP = 20
EXTRA_DROPPED_CAP = 40


def normalize_extra_key(s: str) -> str:
    """Lowercase, non-alphanumerics -> '_', collapse/trim underscores, max 60 chars."""
    import re

    t = re.sub(r"[^a-z0-9]+", "_", str("" if s is None else s).lower())
    t = re.sub(r"_+", "_", t)
    t = re.sub(r"^_+|_+$", "", t)
    return re.sub(r"_+$", "", t[:60])


def is_static_extra_key(key: str, universal_names: set[str]) -> bool:
    """C14c: static when a universal name or `<person|location|firm>_<universal name>`."""
    import re

    if key in universal_names:
        return True
    m = re.match(r"^(person|location|firm)_(.+)$", key)
    return bool(m) and m.group(2) in universal_names


def extra_key_words(key: str) -> str:
    words = [w for w in normalize_extra_key(key).split("_") if w]
    words = [w[:-1] if len(w) > 3 and w.endswith("s") else w for w in words]
    return "_".join(sorted(set(words)))


EXTRA_FILLER_WORDS = {"list", "item", "items", "info", "information", "detail", "details", "text",
                      "section", "page", "value", "data", "other"}


def meaningful_words(s: str) -> set[str]:
    """C14b: meaningful words (4+ letters, trailing 's' removed, filler words skipped)."""
    import re

    out: list[str] = []
    for w in re.split(r"[^a-z]+", str("" if s is None else s).lower()):
        if len(w) < 4 or w in EXTRA_FILLER_WORDS:
            continue
        b = w.removesuffix("s")
        if b in EXTRA_FILLER_WORDS:
            continue
        if b not in out:
            out.append(b)
    return set(out)


def shares_meaningful_word(a: str, b: str) -> bool:
    return bool(meaningful_words(a) & meaningful_words(b))


def _norm_agree(s: str) -> str:
    """C14b: lowercase, punctuation -> space, collapse whitespace."""
    import re

    from ._js import replace_non_ln

    return trim(re.sub(r"\s+", " ", replace_non_ln(str("" if s is None else s).lower(), " ",
                                                    keep_space=True)))


def extra_sample_items(sample: str) -> list[str]:
    """C14b: items of the AI sample used for the agreement check."""
    import re

    raw = re.sub(r"(\.\.\.|…)\s*$", "", str("" if sample is None else sample), count=1)
    items = [x for x in (_norm_agree(y) for y in re.split(r"[,\n•·;|]", raw)) if len(x) >= 3]
    if len(items) == 1:
        return [trim(items[0][:40])]
    return items


def extra_sample_agrees(sample: str | None, values: list[Any]) -> bool:
    """C14b: the rule agrees when one sample item is contained in a value."""
    from ._js import js_str

    items = extra_sample_items(sample or "")
    if not items:
        return False
    texts = []
    for v in values:
        if v is None:
            continue
        if isinstance(v, list):
            t = " \n ".join(js_str(x) if x is not None else "" for x in v)
        elif isinstance(v, dict):
            t = json_stringify(v)
        else:
            t = js_str(v)
        texts.append(_norm_agree(t))
    return any(t and any(it in t for it in items) for t in texts)


def choose_extra_container(loc: dict[str, Any], inputs: list[Any], sample: str | None
                           ) -> dict[str, Any]:
    """C14b: for a multi extra rule across several parents, pick the container with a sample
    item and store how to find it again (nearest heading, else index)."""
    if not loc or loc.get("strategy") != "css" or not loc.get("css") or not loc.get("multi"):
        return loc
    items = extra_sample_items(sample or "")
    if not items:
        return loc
    for inp in inputs:
        soup = ctx_for(inp, "", set(), {}).soup()
        if soup is None:
            continue
        try:
            lst = _dom.select(soup, loc["css"])
        except Exception:  # noqa: BLE001, S112 — TS catch-all
            continue
        parents, _groups = group_by_parent(lst)
        if len(parents) < 1:
            continue
        for i, p in enumerate(parents):
            t = _norm_agree(extra_text(p))
            if not any(it in t for it in items):
                continue
            base = {k: v for k, v in loc.items()
                    if k not in ("container_heading", "container_index")}
            # C14c: always record the heading, also when the samples show one container.
            heading = nearest_heading(soup, p)
            if heading:
                return {**base, "container_heading": heading}
            if len(parents) > 1:
                return {**base, "container_index": i}
            break
    return loc


def finalize_extra_fields(
    fields: dict[str, Any],
    extra_meta: dict[str, Any],
    per_sample_values: list[dict[str, Any]],
    sample_count: int,
) -> dict[str, Any]:
    """Move accepted 'extra.*' specs out of ``fields``; returns ``{fields, extra_fields,
    dropped}``."""
    from ._js import js_str

    rest: dict[str, Any] = {}
    extra_fields: dict[str, Any] = {}
    dropped: list[dict[str, Any]] = []

    def rule_of(f: dict[str, Any]) -> dict[str, Any] | None:
        lc = f.get("locator") or {}
        if lc.get("tier") != "css" or lc.get("strategy") not in ("css", "label"):
            return None
        r: dict[str, Any] = {"strategy": lc["strategy"]}
        for k in ("css", "label", "attr"):
            if lc.get(k):
                r[k] = lc[k]
        if lc.get("multi"):
            r["multi"] = True
        return r

    def as_text(v: Any, sep: str) -> str:
        if isinstance(v, list):
            return sep.join(js_str(x) if x is not None else "" for x in v)
        return v if isinstance(v, str) else json_stringify(v)

    for fid, f in fields.items():
        if not is_extra_id(fid):
            rest[fid] = f
            continue
        key = fid[len(EXTRA_PREFIX):]
        meta = extra_meta.get(key) or {"label": key, "key_source": "new"}
        vals = [v[key] for v in per_sample_values if v.get(key) is not None]
        rule = rule_of(f)
        diag: dict[str, Any] = {**({"rule": rule} if rule is not None else {}),
                                "found": len(vals), "samples": sample_count}
        if len(vals) >= 3:
            counts: dict[str, dict[str, Any]] = {}
            for v in vals:
                k = norm_val(v)
                if k in counts:
                    counts[k]["n"] += 1
                else:
                    counts[k] = {"n": 1, "v": v}
            top = min(counts.values(), key=lambda c: -c["n"]) if counts else None
            if top and top["n"] / len(vals) >= 0.6 and len(trim(as_text(top["v"], ", "))) > 30:
                dropped.append({"label": meta.get("label"), "key": key,
                                "reason": "site_wide_value", **diag})
                continue
        if len(vals) < 2:
            dropped.append({"label": meta.get("label"), "key": key, "reason": "low_support",
                            **diag})
            continue
        if len(extra_fields) >= EXTRA_FIELDS_CAP:
            continue
        spec = {**f, "hits": len(vals), "samples": sample_count, "label": meta.get("label"),
                "key_source": meta.get("key_source")}
        if meta.get("sample"):
            spec["sample"] = str(meta["sample"])[:200]
        examples: list[str] = []
        for v in vals:
            t = trim(as_text(v, "; "))[:120]
            if t and t not in examples:
                examples.append(t)
            if len(examples) >= 3:
                break
        spec["examples"] = examples
        extra_fields[key] = spec
    return {"fields": rest, "extra_fields": extra_fields, "dropped": dropped}


def _entries(contract: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    return [
        *[(fid, f) for fid, f in (contract.get("fields") or {}).items() if not is_extra_id(fid)],
        *[(TAX_PREFIX + slug, f) for slug, f in (contract.get("taxonomy_fields") or {}).items()],
    ]


def apply_value_rules(
    values: dict[str, Any], contract: dict[str, Any], page_url: str
) -> dict[str, Any]:
    """Fix (taxonomy copies on profile-API records, 2026-10-15): run the contract's value-only
    rules (derived address parts, alias copies) on a finished value map, with no page."""
    from .apply import tax_subject_of

    contract = contract or {}
    out = dict(values)
    action_ids = {TAX_PREFIX + slug for slug, f in (contract.get("taxonomy_fields") or {}).items()
                  if f.get("action")}
    opts = {"own_page_key": contract.get("own_page_key"), "action_ids": action_ids,
            "primary": contract.get("primary_subject")}
    ctx = ctx_for(ParsedDoc(), page_url, set(), opts).with_values(out)
    entries = _entries(contract)
    set_ids: list[str] = []
    for fid, f in entries:
        loc = f.get("locator") if is_derived(f.get("locator")) else (
            f["backup"] if f.get("backup") and is_derived(f.get("backup")) else None)
        if not loc or not is_empty_value(out.get(fid)):
            continue
        v = apply_locator(loc, f.get("type"), fid, ctx)
        if v is not None:
            out[fid] = v
            set_ids.append(fid)
    for fid, f in entries:
        loc = f.get("locator")
        if not is_alias(loc) or is_empty_value(out.get(loc.get("from"))):
            continue
        v = apply_locator(loc, f.get("type"), fid, ctx)
        if v is not None:
            out[fid] = v
            set_ids.append(fid)
    pn = norm_val(out["person.name"]) if out.get("person.name") is not None else ""
    if pn:
        by_id = dict(entries)
        for fid in set_ids:
            f = by_id.get(fid)
            if not f or not is_tax_id(fid):
                continue
            subj = tax_subject_of(fid, f, opts)
            if subj and subj != "person" and fid in out and norm_val(out[fid]) == pn:
                del out[fid]
    return out


def apply_extra_fields(
    input_: Any,
    page_url: str,
    contract: dict[str, Any],
    site_entity_names: set[str],
    opts: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Apply ``contract.extra_fields`` to one page; returns { key: value } for non-empty values."""
    out: dict[str, Any] = {}
    specs = list(((contract or {}).get("extra_fields") or {}).items())
    if not specs:
        return out
    ctx = ctx_for(input_, page_url, site_entity_names, opts)
    for key, f in specs:
        if not f or not f.get("locator"):
            continue
        v = apply_locator(f["locator"], f.get("type"), EXTRA_PREFIX + key, ctx)
        if v is None and f.get("backup"):
            v = apply_locator(f["backup"], f.get("type"), EXTRA_PREFIX + key, ctx)
        if v is None or (isinstance(v, str) and trim(v) == "") or (isinstance(v, list) and not v):
            continue
        out[key] = v
    return out


ADDRESS_PARTS = ["street", "city", "state", "postal_code"]


def add_derived_address_fields(
    fields: dict[str, Any],
    samples: list[Any],
    site_entity_names: set[str],
    opts: dict[str, Any] | None = None,
) -> None:
    """Fix 8: derive city/state/postal_code/street from a mapped <subject>.address_block
    (mutates ``fields``)."""
    for subject in ("location", "person", "firm"):
        src = f"{subject}.address_block"
        if not fields.get(src):
            continue
        for part in ADDRESS_PARTS:
            fid = f"{subject}.{part}"
            derived = {"tier": "css", "derived_from": src, "part": part}
            existing = fields.get(fid)
            if existing:
                if not is_derived(existing.get("locator")) and not existing.get("backup"):
                    fields[fid] = {**existing, "backup": derived}
                continue
            fields[fid] = {"tier": "css", "locator": derived, "type": field_type(fid),
                           "hits": 0, "samples": len(samples)}
    per = [apply_site_contract(doc_of(s), sample_get(s, "url") or "", {"fields": fields},
                               site_entity_names, opts)["values"] for s in samples]
    for fid, f in list(fields.items()):
        if not is_derived(f.get("locator")):
            continue
        hits = sum(1 for v in per if v.get(fid) is not None)
        if hits < 1:
            del fields[fid]
        else:
            fields[fid] = {**f, "hits": hits}


# Fix 7 (2026-09-25): the address is learned once, on the location.
PERSON_ADDRESS_IDS = ["person.street", "person.city", "person.state", "person.postal_code",
                      "person.address_block"]
LOCATION_ADDRESS_IDS = ["location.street", "location.city", "location.state",
                        "location.postal_code"]


def _hits(fields: dict[str, Any], fid: str) -> int:
    f = fields.get(fid)
    h = f.get("hits") if isinstance(f, dict) else None
    return h if isinstance(h, (int, float)) else 0


def has_location_address(fields: dict[str, Any]) -> bool:
    return any(_hits(fields, fid) >= 1 for fid in LOCATION_ADDRESS_IDS)


def suppressed_ids(fields: dict[str, Any], primary: str) -> set[str]:
    return set(PERSON_ADDRESS_IDS) if primary == "person" and has_location_address(fields) \
        else set()


def locator_target_ids(jsonld_fields: dict[str, Any], primary: str) -> list[str]:
    """Field ids the locator should be asked for after the JSON-LD tier."""
    skip = suppressed_ids(jsonld_fields, primary)
    # C9: firm ids are asked for in the brand-pass section.
    return [fid for fid in all_field_ids(primary)
            if not jsonld_fields.get(fid) and fid not in skip and not fid.startswith("firm.")]


FIRM_EQUIVALENT = {
    "phone": "firm.phone_main", "logo_url": "firm.logo_url", "website": "firm.website",
    "social_links": "firm.social_links", "business_name": "firm.firm_name",
}

MUST_HAVE_REQUIRED = ["name", "phone|email", "city", "state"]


def must_have_ids(label: str, primary: str, name_owner: str | None = None) -> list[str]:
    if label == "name":
        if primary == "person" and name_owner == "location":
            return ["person.name", "location.business_name"]
        return ["person.name" if primary == "person" else "location.business_name"]
    if label == "phone|email":
        return ["person.phone", "person.email", "location.phone", "location.email"]
    if label == "city":
        return ["person.city", "location.city"]
    if label == "state":
        return ["person.state", "location.state"]
    return []


def compute_must_have(fields: dict[str, Any], primary: str, name_owner: str | None = None
                      ) -> dict[str, Any]:
    missing = [label for label in MUST_HAVE_REQUIRED
               if not any(_hits(fields, fid) >= 1
                          for fid in must_have_ids(label, primary, name_owner))]
    return {"required": list(MUST_HAVE_REQUIRED), "ok": not missing, "missing": missing}


def finalize_site_contract(args: dict[str, Any] | None = None, /, **kw: Any) -> dict[str, Any]:
    """Recompute hits, apply the firm-reclassification safeguard, and assemble the contract.

    Arguments (TS camelCase or snake_case): fields, failed, samples, primary,
    site_entity_names, unkeyed, opts, taxonomy, rejected_rules.
    """
    a = kwargs_of(args, kw)
    samples: list[Any] = a.get("samples") or []
    primary: str = a["primary"]
    site_entity_names: set[str] = a.get("site_entity_names") or set()
    opts = norm_opts(a.get("opts"))
    a_fields: dict[str, Any] = a.get("fields") or {}
    rejected_rules: dict[str, Any] = a.get("rejected_rules") or {}
    unmapped: list[dict[str, Any]] = []
    applied = [apply_site_contract(doc_of(s), sample_get(s, "url") or "", {"fields": a_fields},
                                   site_entity_names, opts) for s in samples]
    per_sample = [x["values"] for x in applied]
    rejected_per_sample = [x["rejected"] for x in applied]
    rejected_address_per_sample = [x["rejectedAddress"] for x in applied]
    rejected_photo_per_sample = [x["rejectedPhoto"] for x in applied]
    fields: dict[str, Any] = {}
    dropped: set[str] = set()

    for fid, f in a_fields.items():
        if is_tax_id(fid) or is_extra_id(fid):
            continue
        vals = [v[fid] for v in per_sample if v.get(fid) is not None]
        hits = len(vals)
        parts = fid.split(".")
        subject = parts[0]
        key = parts[1] if len(parts) > 1 else None
        # Fix (state from one region, 2026-10-06).
        region_key = key in ("state", "country")
        address_varies = region_key and any(
            len({json_stringify(v[f"{subject}.{k}"]) for v in per_sample
                 if v.get(f"{subject}.{k}") is not None}) > 1
            for k in ("street", "postal_code"))
        site_wide = (subject != "firm" and not address_varies and hits >= 3
                     and hits == len(samples)
                     and all(json_stringify(v) == json_stringify(vals[0]) for v in vals))
        # Fix (site-wide location fields kept, 2026-10-22).
        keep_on_location = (site_wide and primary == "location" and subject == "location"
                            and key not in FIRM_EQUIVALENT and key not in ("email", "fax"))
        if site_wide and not keep_on_location:
            firm_id = FIRM_EQUIVALENT.get(key or "")
            if firm_id:
                if not a_fields.get(firm_id) and not fields.get(firm_id):
                    fields[firm_id] = {**f, "type": field_type(firm_id), "hits": hits,
                                       "samples": len(samples)}
            else:
                dropped.add(fid)
                unmapped.append({"id": fid, "reason": "site_wide_value"})
            continue
        if hits >= 1:
            fields[fid] = {**f, "hits": hits, "samples": len(samples)}
        elif subject == "firm" and f.get("homepage_only"):
            fields[fid] = {**f, "hits": 0, "samples": len(samples)}

    # Fix 7: person address rules are kept only where they differ from the location address.
    address_owner = "location" if has_location_address(fields) else None
    if primary == "person" and has_location_address(fields):
        for pid in PERSON_ADDRESS_IDS:
            if not fields.get(pid):
                continue
            lid = "location." + key_of(pid)
            distinct = any(v.get(pid) is not None and norm_val(v[pid]) != norm_val(v.get(lid))
                           for v in per_sample)
            if not distinct:
                del fields[pid]
    # Fix 8: derived locators whose address_block source was dropped go too.
    for fid, f in list(fields.items()):
        if is_derived(f.get("locator")) and not fields.get(f["locator"]["derived_from"]):
            del fields[fid]
        elif is_derived(f.get("backup")) and not fields.get(f["backup"]["derived_from"]):
            fields[fid] = {k: v for k, v in f.items() if k != "backup"}
    if primary == "person" and any(fields.get(fid) for fid in PERSON_ADDRESS_IDS):
        address_owner = "person"

    failed = set(a.get("failed") or [])
    skip = suppressed_ids(fields, primary)
    for fid in all_field_ids(primary):
        if fields.get(fid) or fid in dropped or fid in skip:
            continue
        rr = rejected_rules.get(fid) if fid in failed else None
        unmapped.append({
            "id": fid,
            "reason": "rule_failed_validation" if fid in failed else "not_found_on_samples",
            **(rr or {}),
        })

    tax = finalize_taxonomy(a_fields, failed, per_sample, a.get("taxonomy") or [], len(samples),
                            fields, rejected_per_sample, rejected_address_per_sample,
                            rejected_photo_per_sample, primary)

    # Fix (name owner, 2026-10-05).
    any_person_record = any(classify_subject(o, site_entity_names, opts) == "person"
                            for s in samples for o in doc_of(s).objs)
    name_owner = "location" if (primary == "person" and not fields.get("person.name")
                                and not any_person_record
                                and _hits(fields, "location.business_name") >= 1) else None

    out: dict[str, Any] = {
        "version": 3,
        "primary_subject": primary,
        "fields": fields,
        "must_have": compute_must_have(fields, primary, name_owner),
        "address_owner": address_owner,
    }
    if name_owner:
        out["name_owner"] = name_owner
    out.update({
        "unmapped": unmapped,
        "unkeyed": list(a.get("unkeyed") or [])[:20],
        "samples": [sample_get(s, "url") for s in samples],
        "learned_at": iso_now(),
        **tax,
    })
    return out


ORGANIZATION_TYPES = {"organization", "corporation", "ngo", "governmentorganization",
                      "educationalorganization"}


def is_org_type(t: str | None) -> bool:
    return bool(t) and trim(t).lower() in ORGANIZATION_TYPES


def finalize_taxonomy(
    fields: dict[str, Any],
    failed: set[str],
    per_sample: list[dict[str, Any]],
    keys: list[dict[str, Any]],
    sample_count: int,
    final_universal: dict[str, Any] | None = None,
    rejected_per_sample: list[list[str]] | None = None,
    rejected_address_per_sample: list[list[str]] | None = None,
    rejected_photo_per_sample: list[list[str]] | None = None,
    primary: str = "person",
) -> dict[str, Any]:
    final_universal = final_universal or {}
    rps = rejected_per_sample or []
    raps = rejected_address_per_sample or []
    rpps = rejected_photo_per_sample or []
    taxonomy_fields: dict[str, Any] = {}
    taxonomy_unmapped: list[dict[str, Any]] = []
    sig: dict[str, list[str]] = {}
    for k in keys:
        f = fields.get(k["id"])
        # C1: an alias whose universal source did not survive finalisation is dropped.
        if f and is_alias(f.get("locator")) and not final_universal.get(f["locator"].get("from")):
            f = None
        vals = [v.get(k["id"]) for v in per_sample]
        present = [v for v in vals if v is not None]
        hits = len(present)
        if not f or (hits < 1 and not f.get("homepage_only")):
            iw = k.get("item_words")
            ambiguous = iw is not None and (len(iw) == 0 or bool(k.get("ambiguous_seen")))
            name_rej = (bool(f) and sample_count > 0 and len(rps) == sample_count
                        and all(k["id"] in r for r in rps))
            addr_rej = name_rej and len(raps) == sample_count and all(k["id"] in r for r in raps)
            photo_rej = name_rej and len(rpps) == sample_count and all(k["id"] in r for r in rpps)
            taxonomy_unmapped.append({
                "slug": k["slug"],
                "reason": "equals_address" if addr_rej else "equals_person_photo" if photo_rej
                else "equals_person_name" if name_rej
                else "ambiguous_shared_property" if ambiguous
                else "rule_failed_validation" if k["id"] in failed else "not_found_on_samples",
            })
            continue
        loc = f.get("locator") or {}
        subject = loc.get("subject") if (loc.get("tier") == "jsonld" and not is_derived(loc)) \
            else (k.get("subjects") or [None])[0]
        if f.get("homepage_only") and hits < 1:
            subject = "firm"
        # Fix 13 / Fix 17 / C4: a value identical on every sample (>= 3) is site-wide, except
        # credential classifier matches.
        credential_match = is_classifier(loc) and loc.get("classifier") == "credential"
        site_wide = (not credential_match and hits >= 3
                     and all(json_stringify(v) == json_stringify(present[0]) for v in present))
        if site_wide and subject != "firm":
            # Fix (site-wide values to brand, 2026-10-22).
            if k.get("schema_type") is None or is_org_type(k.get("schema_type")) \
                    or primary == "location":
                subject = "firm"
            else:
                taxonomy_unmapped.append({"slug": k["slug"], "reason": "site_wide_value"})
                continue
        spec = {**f, "hits": hits, "samples": sample_count, "subject": subject,
                "scope": k.get("scope")}
        if k.get("action"):
            spec["action"] = True
        if k.get("prop_last") == "logo":
            spec["logo"] = True
        taxonomy_fields[k["slug"]] = spec
        key = json_stringify([None if v is None else norm_val(v) for v in vals])
        sig.setdefault(key, []).append(k["slug"])
    taxonomy_duplicates = [g for g in sig.values() if len(g) >= 2]
    return {
        "taxonomy_fields": taxonomy_fields,
        "taxonomy_unmapped": taxonomy_unmapped,
        "taxonomy_duplicates": taxonomy_duplicates,
        "taxonomy_candidates": len(keys),
    }
