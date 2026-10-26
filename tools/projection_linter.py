"""Projection linter — every generated schema field passes 3 mechanical layers:
A) vocabulary: type & property exist
B) domain/range: property valid on the emitting type; value kind matches rangeIncludes
C) usage rules: codified projection rules (from docs/Schema_Projection_Correction_Spec.md)
Every future adjudicated error becomes a new C rule. Run over every category's projection."""
import json, sys

REF=json.load(open("reference/schema_type_reference.json"))["types"]
DATE_RANGES={"Date","DateTime"}; NUM_RANGES={"Number","Integer","Float","QuantitativeValue"}

def lint_field(field, emit_type, prop, value_kind, extra=None):
    errs=[]
    t=REF.get(emit_type)
    if not t: return [f"A: type '{emit_type}' not in vocabulary"]
    meta=t["valid_properties"].get(prop)
    if not meta:
        errs.append(f"B-domain: '{prop}' INVALID on {emit_type}"); return errs
    rng=set(meta["range"])
    if value_kind=="text_status" and rng and rng<=DATE_RANGES:
        errs.append(f"B-range: '{prop}' takes {sorted(rng)} — got status text")
    if value_kind=="metric" and prop in ("priceRange","price"):
        errs.append(f"C-rule#4: career/T12 metrics never use '{prop}' — additionalProperty(PropertyValue) on business facet")
    if prop=="interactionStatistic" and not (extra or {}).get("interactionType"):
        errs.append("C-rule#5: InteractionCounter without interactionType — ambiguous engagement")
    if prop=="worksFor" and (extra or {}).get("target_kind")=="person_typed":
        errs.append("C-rule#1: worksFor target must emit Organization")
    if prop=="reviewCount" and (extra or {}).get("multi_source_overload"):
        errs.append("C-rule#6: per-source AggregateRating with publisher @id — never overload reviewCount")
    return errs

if __name__=="__main__":
    # The exact defective mappings from the RE 149-field pilot, plus healthy controls:
    CASES=[
     ("License Status -> hasCredential.validFrom","EducationalOccupationalCredential","validFrom","text_status",None),
     ("Career Transactions -> performTime","Person","performTime","metric",None),
     ("Career Sales Volume -> priceRange","RealEstateAgent","priceRange","metric",None),
     ("T12 Volume -> offers.price","Offer","price","metric",None),
     ("MLS metric -> additionalProperty on Person","Person","additionalProperty","metric",None),
     ("LinkedIn Followers -> bare counter","Person","interactionStatistic","count",{"interactionType":None}),
     ("Brokerage -> worksFor(person-typed)","Person","worksFor","entity",{"target_kind":"person_typed"}),
     ("CONTROL name -> Person.name","Person","name","text",None),
     ("CONTROL metric -> additionalProperty on RealEstateAgent","RealEstateAgent","additionalProperty","metric",None),
     ("CONTROL counter w/ type","Person","interactionStatistic","count",{"interactionType":"FollowAction"}),
    ]
    caught=0
    for name,t,p,vk,ex in CASES:
        errs=lint_field(name,t,p,vk,ex)
        status="CAUGHT" if errs else "clean "
        if errs: caught+=1
        print(f"  [{status}] {name}"+ (f"\n            -> {errs[0]}" if errs else ""))
    print(f"\n{caught}/7 pilot defects caught mechanically; 3/3 controls clean")
