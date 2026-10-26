"""Projection generator (factory component 1): registry nodes -> CategorySchema.
Deterministic code, no model. Input: gcid, display name, entity_type, root schema_type,
registry nodes [{node_name,node_slug,ring,connection_method,schema_type,schema_property}],
optional taxonomy terms + conversion actions. Output: CategorySchema (schema-tab contract)
+ lint report. Every emitted (type, property) pair passes the projection linter, per hop.
"""
import json, sys, os
sys.path.append(os.path.dirname(__file__))
from projection_linter import lint_field

REF = json.load(open(os.path.join(os.path.dirname(__file__), "..", "reference", "schema_type_reference.json")))["types"]

RING_ORDER = ["identity", "presence", "location", "authority", "services",
              "content", "reputation", "engagement", "conversion", "entity_graph"]
RING_NAME = {"identity": "Identity", "presence": "Presence", "location": "Location",
             "authority": "Authority", "services": "Services", "content": "Content",
             "reputation": "Reputation", "engagement": "Engagement",
             "conversion": "Conversion", "entity_graph": "Entity Graph"}
RING_GROUP = {"identity": "root identity + contact", "presence": "sameAs / ProfilePage",
              "location": "PostalAddress / GeoCoordinates / areaServed",
              "authority": "EducationalOccupationalCredential / Occupation / PropertyValue",
              "services": "Service / OfferCatalog / Offer",
              "content": "CreativeWork (author @id -> professional)",
              "reputation": "AggregateRating / Review (per-source publisher @id)",
              "engagement": "InteractionCounter + interactionType",
              "conversion": "potentialAction -> Action subtypes",
              "entity_graph": "worksFor / memberOf / parentOrganization"}
SOURCE_LABEL = {"manual": "Profile", "platform": "Platform", "etl": "ETL", "oauth": "Social",
                "crm_sync": "CRM", "rss": "CMS", "api": "API"}
# complex-valued properties get typed sub-objects in JSON-LD (all gated slots)
COMPLEX = {
    "address": '{ "@type": "PostalAddress", "streetAddress": "{street}", "addressLocality": "{city}", "addressRegion": "{state}", "postalCode": "{zip}" }',
    "geo": '{ "@type": "GeoCoordinates", "latitude": "{lat}", "longitude": "{lng}" }',
    "areaServed": '[{ "@type": "City", "name": "{city}" }]',
    "hasCredential": '[{ "@type": "EducationalOccupationalCredential", "credentialCategory": "license", "identifier": "{license_number}", "name": "{license_label}", "recognizedBy": { "@type": "GovernmentOrganization", "name": "{licensing_body}" }, "expires": "{license_expiration}" }]',
    "hasOccupation": '{ "@type": "Occupation", "name": "{occupation_name}" }',
    "worksFor": '{ "@type": "Organization", "name": "{parent_org_name}" }',
    "memberOf": '[{ "@type": "Organization", "name": "{membership_name}" }]',
    "parentOrganization": '{ "@type": "Organization", "name": "{parent_org_name}" }',
    "aggregateRating": '{ "@type": "AggregateRating", "ratingValue": "{rating}", "reviewCount": "{review_count}", "bestRating": "5" }',
    "review": '[{ "@type": "Review", "reviewBody": "{review_text}", "reviewRating": { "@type": "Rating", "ratingValue": "{review_rating}" }, "author": { "@type": "Person", "name": "{reviewer}" }, "datePublished": "{review_date}", "publisher": { "@type": "Organization", "@id": "{review_source_id}" } }]',
    "interactionStatistic": '[{ "@type": "InteractionCounter", "interactionType": { "@type": "FollowAction" }, "interactionService": { "@type": "WebSite", "name": "{social_platform}" }, "userInteractionCount": "{follower_count}" }]',
    "hasOfferCatalog": '{ "@type": "OfferCatalog", "name": "{catalog_name}", "itemListElement": {service_offers} }',
    "makesOffer": "{active_offers}",
    "openingHoursSpecification": '[{ "@type": "OpeningHoursSpecification", "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Friday"], "opens": "09:00", "closes": "18:00" }]',
    "subjectOf": '[{ "@type": "Article", "headline": "{article_title}", "datePublished": "{article_date}", "author": { "@id": "{profile_url}#professional" } }]',
    "contactPoint": '{ "@type": "ContactPoint", "telephone": "{phone}", "contactType": "{contact_type}" }',
}


def _range(emit_type, prop):
    root = prop.split(".")[0]
    m = REF.get(emit_type, {}).get("valid_properties", {}).get(root)
    return m["range"][0] if m else "Text"


def _facet(prop, professional_type, business_type, stored_type=None):
    """Pick the valid emitting facet: stored node type first, then lane facets.
    Returns (facet, verdict): verdict 'ok' | 'other_lane' (skip silently) | 'invalid'."""
    root = prop.split(".")[0]
    for t in (stored_type, professional_type, business_type):
        if t and root in REF.get(t, {}).get("valid_properties", {}):
            return t, "ok"
    # valid on the facet the OTHER lane carries? then it belongs there, not here
    other = "Person" if professional_type is None else None
    if other and root in REF.get(other, {}).get("valid_properties", {}):
        return None, "other_lane"
    return None, "invalid"


def generate(gcid, display_name, entity_type, business_type, nodes,
             conversion_actions=None, taxonomy=None):
    """Returns (CategorySchema dict, lint_errors list)."""
    professional = entity_type in ("both", "professional")
    prof_type = "Person"
    errors, lanes = [], []

    def build_fields(lane_kind):
        by_ring = {r: [] for r in RING_ORDER}
        for n in nodes:
            prop = n.get("schema_property")
            if not prop:  # platform-only field: keep as row, no markup
                by_ring[n["ring"]].append({"label": n["node_name"], "prop": "— (platform only)",
                                           "type": "Platform", "source": SOURCE_LABEL.get(n["connection_method"], "Profile")})
                continue
            root = prop.split(".")[0]
            facet, verdict = _facet(prop, prof_type if (lane_kind == "professional" and professional) else None,
                                    business_type, n.get("schema_type"))
            if verdict == "other_lane":
                continue  # field belongs to the other lane's facet
            if verdict == "invalid":
                errors.append((n["node_name"], f"no valid facet for '{root}' (defective node data)"))
                continue
            e = lint_field(n["node_name"], facet, root, "value",
                           {"interactionType": "typed"} if root == "interactionStatistic" else None)
            if e:
                errors.append((n["node_name"], e))
            by_ring[n["ring"]].append({"label": n["node_name"], "prop": prop,
                                       "type": _range(facet, prop),
                                       "source": SOURCE_LABEL.get(n["connection_method"], "Profile")})
        # conversion actions -> conversion ring rows (gated); lane-aware:
        # dict {"professional":[...],"location":[...]} routes goals to their lane,
        # flat list applies to all lanes (legacy callers)
        for act in _lane_actions(lk):
            if act["schema_action"] not in REF:
                errors.append((act["label"], f"action '{act['schema_action']}' not in vocabulary"))
                continue
            by_ring["conversion"].append({"label": act["label"],
                                          "prop": f"potentialAction ({act['schema_action']})",
                                          "type": act["schema_action"], "source": "Logic layer"})
        return [{"n": i + 1, "name": RING_NAME[r], "group": RING_GROUP[r], "fields": by_ring[r]}
                for i, r in enumerate(RING_ORDER) if by_ring[r]]

    def _lane_actions(lane_kind):
        if isinstance(conversion_actions, dict):
            la = conversion_actions.get(lane_kind)
            if la: return la
            return [a for v in conversion_actions.values() for a in v]
        return conversion_actions or []

    def build_jsonld(lane_kind):
        lane_actions = _lane_actions(lane_kind)
        roots, seen = [], set()
        for n in nodes:
            prop = n.get("schema_property")
            if not prop:
                continue
            root = prop.split(".")[0]
            if root in seen:
                continue
            seen.add(root)
            facet, verdict = _facet(prop, prof_type if (lane_kind == "professional" and professional) else None,
                                    business_type, n.get("schema_type"))
            if verdict != "ok":
                continue
            val = COMPLEX.get(root, f'"{{{n["node_slug"]}}}"')
            roots.append(f'  "{root}": {val}')
        if lane_actions:
            acts = ", ".join(f'{{ "@type": "{a["schema_action"]}", "name": "{a["label"]}", "target": "{{action_url}}" }}'
                             for a in lane_actions if a["schema_action"] in REF)
            roots.append(f'  "potentialAction": [{acts}]')
        types = f'["Person", "{business_type}"]' if (lane_kind == "professional" and professional) else \
                f'["{business_type}", "LocalBusiness"]' if business_type != "LocalBusiness" else '"LocalBusiness"'
        body = ",\n".join(roots)
        return ('{\n  "@context": "https://schema.org",\n'
                f'  "@id": "{{profile_url}}#{lane_kind}",\n  "@type": {types},\n'
                f'  "name": "{{name}}",\n{body}\n}}')

    def build_seo(lane_kind):
        noun = display_name.lower()
        who = "{name}" if lane_kind == "professional" else "{business_name}"
        kw = ", ".join([noun] + [t["term"] for t in (taxonomy or []) if t.get("level") == "keyword"][:6]) or noun
        pairs = [["title", f"{who} — {display_name} in {{city}}, {{state}} | Experience.com"],
                 ["description", f"{who} is a {noun} serving {{city}}. {{review_count}} verified reviews. Schedule or contact today."],
                 ["keywords", kw], ["canonical", "{profile_url}"],
                 ["robots", "index, follow, max-image-preview:large"],
                 ["geo.region", "US-{state}"], ["geo.placename", "{city}"],
                 ["og:type", "profile" if lane_kind == "professional" else "business.business"],
                 ["og:title", f"{who} — {display_name} in {{city}}"],
                 ["og:description", "{rating}\u2605 ({review_count} reviews) \u00b7 {city}, {state}"],
                 ["og:image", "{photo_url}"], ["og:url", "{profile_url}"],
                 ["og:site_name", "Experience.com"], ["twitter:card", "summary_large_image"],
                 ["twitter:title", f"{who} — {{city}} {display_name}"],
                 ["twitter:description", "{rating}\u2605 \u00b7 {review_count} verified reviews"],
                 ["twitter:image", "{photo_url}"], ["author", who]]
        if lane_kind == "location":
            pairs += [["geo.position", "{lat};{lng}"], ["ICBM", "{lat}, {lng}"]]
        return pairs

    def build_profile(lane_kind):
        rings = {n["ring"] for n in nodes}
        who = "{name}" if lane_kind == "professional" else "{business_name}"
        secs = [{"kind": "header", "name": who, "subtitle": f"{display_name} \u00b7 {{credential_line}}",
                 "initials": "{initials}", "badges": ["Verified"], "rating": "{rating}",
                 "ratingCount": "{review_count}", "chips": ["{location_chip}"],
                 "bio": "{bio}", "ctas": ["{primary_cta}", "{secondary_cta}"]},
                {"kind": "infoCards", "cards": [
                    {"title": "Contact", "lines": ["{phone}", "{city}, {state}", "{website}"], "chips": ["{social_chips}"]},
                    {"title": "Credentials", "lines": ["{license_line}", "{memberships_line}"], "chips": ["{designation_chips}"]}]},
                {"kind": "lines", "title": "About", "lines": ["{about_line_1}", "{about_line_2}"]}]
        if "authority" in rings:
            secs.append({"kind": "stats", "title": "Track record",
                         "stats": [{"value": "{stat1}", "label": "{stat1_label}"},
                                   {"value": "{stat2}", "label": "{stat2_label}"}]})
        if "services" in rings or conversion_actions:
            secs.append({"kind": "services", "title": "Products & services", "items": ["{service_items}"]})
        if taxonomy:
            chips = [t["term"] for t in taxonomy if t.get("level") == "specialization"][:8]
            if chips:
                secs.append({"kind": "chips", "title": "Specialties", "chips": chips})
        secs.append({"kind": "score", "title": "Search rank score", "value": 0, "max": 850})
        if "reputation" in rings or lane_kind == "location":
            secs.append({"kind": "reviews", "title": "Reviews", "sources": ["Experience.com", "Google"],
                         "reviews": [{"author": "{reviewer}", "loc": "{city}", "rating": "{review_rating}",
                                      "date": "{review_date}", "body": "{review_text}"}]})
        if lane_kind == "location":
            secs.insert(3, {"kind": "roster", "title": "Professionals", "members": [
                {"initials": "{m_initials}", "name": "{m_name}", "meta": "{m_meta}"}],
                "note": "Roster ranked by search rank score."})
        secs.append({"kind": "disclaimer", "text": "{compliance_disclaimer}"})
        return secs

    def build_html(lane_kind):
        return (f'<main itemscope itemtype="https://schema.org/{business_type}">\n'
                + ('  <link itemprop="additionalType" href="https://schema.org/Person" />\n'
                   if lane_kind == "professional" and professional else "")
                + '  <h1 itemprop="name">{name}</h1>\n'
                  '  <span itemprop="telephone">{phone}</span>\n'
                  '  <div itemprop="address" itemscope itemtype="https://schema.org/PostalAddress">\n'
                  '    <span itemprop="addressLocality">{city}</span>, <span itemprop="addressRegion">{state}</span>\n'
                  '  </div>\n'
                  '  <div itemprop="aggregateRating" itemscope itemtype="https://schema.org/AggregateRating">\n'
                  '    <span itemprop="ratingValue">{rating}</span>\u2605 (<span itemprop="reviewCount">{review_count}</span>)\n'
                  '  </div>\n</main>')

    lane_kinds = (["location", "professional"] if entity_type == "both"
                  else ["professional"] if entity_type == "professional" else ["location"])
    for lk in lane_kinds:
        label = f"{'Professional' if lk == 'professional' else 'Location'} ({lk})"
        stype = (f"Person + {business_type}" if lk == "professional" and professional
                 else f"{business_type} + LocalBusiness" if business_type != "LocalBusiness" else "LocalBusiness")
        lanes.append({"key": lk, "label": label, "schemaType": stype,
                      "elements": build_fields(lk), "seo": build_seo(lk),
                      "jsonld": build_jsonld(lk), "html": build_html(lk),
                      "profile": build_profile(lk)})
    return {"gcid": gcid, "displayName": display_name, "entityType": entity_type, "lanes": lanes}, errors


if __name__ == "__main__":
    cfg = json.load(open(sys.argv[1]))
    schema, errs = generate(**cfg)
    nf = sum(len(e["fields"]) for l in schema["lanes"] for e in l["elements"])
    print(f"lanes {len(schema['lanes'])} | fields {nf} | lint {'PASS' if not errs else errs}")
    json.dump(schema, open(sys.argv[2], "w"), ensure_ascii=False)
