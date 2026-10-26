import { describe, expect, test } from "bun:test";
import {
  compileCategoryBrief,
  entityBrief,
  entityBriefForOffice,
  type CategoryBriefRows,
  type RingRow,
} from "../src/lib/category-brief";
import { isSinglePro, loadOfficeMode, parseOfficeMode } from "../src/lib/office-mode";
import { listingNap, listingSubject } from "../src/lib/listings/subject";
import insuranceRows from "./fixtures/category-brief.insurance_agency.json";
import restaurantRows from "./fixtures/category-brief.restaurant.json";
import rings from "./fixtures/exp_rings.json";

const rows = (r: unknown, gcid: string): CategoryBriefRows =>
  ({ ...(r as object), gcid, rings: rings as RingRow[] }) as CategoryBriefRows;
const insurance = compileCategoryBrief(rows(insuranceRows, "gcid:insurance_agency"));
const restaurant = compileCategoryBrief(rows(restaurantRows, "gcid:restaurant"));

// exp_office_mode output captured read-only from the live DB (Greg Aldridge, State Farm, 2026-10-11).
const GREG = {
  mode: "single_pro",
  professional_id: "56d35654-1bcd-4ee6-97e3-3571ef61c8f1",
  location_id: "6b253049-8c67-4c7e-8ffc-cf9a5ba5f9c6",
  pro_count: 1,
  gcid: "gcid:insurance_agency",
  supports_single_pro_office: true,
  reason: "one_active_professional",
};
const NAF_OFFICE = {
  mode: "multi_pro",
  professional_id: null,
  location_id: "11111111-0000-4000-8000-000000000002",
  pro_count: 2,
  gcid: "gcid:mortgage_broker",
  supports_single_pro_office: true,
  reason: "multiple_active_professionals",
};

describe("parseOfficeMode", () => {
  test("parses the DB function's jsonb", () => {
    const m = parseOfficeMode(GREG)!;
    expect(m.mode).toBe("single_pro");
    expect(m.locationId).toBe(GREG.location_id);
    expect(isSinglePro(m)).toBe(true);
    expect(isSinglePro(parseOfficeMode(NAF_OFFICE))).toBe(false);
  });
  test("rejects malformed values", () => {
    expect(parseOfficeMode(null)).toBeNull();
    expect(parseOfficeMode({ mode: "solo" })).toBeNull();
  });
  test("loader falls back to null when the function is missing (0027 unapplied)", async () => {
    const missing = { rpc: async () => ({ data: null, error: { message: "function does not exist" } }) };
    expect(await loadOfficeMode(missing, "professional", GREG.professional_id)).toBeNull();
    const live = { rpc: async () => ({ data: GREG, error: null }) };
    expect((await loadOfficeMode(live, "organization", GREG.location_id))?.mode).toBe("single_pro");
  });
});

describe("entityBriefForOffice", () => {
  const pro = entityBrief(insurance, "professional")!;
  const loc = entityBrief(insurance, "location")!;

  test("single_pro acts as the professional (form + claim + licence key)", () => {
    const ob = entityBriefForOffice(insurance, "single_pro", "location")!;
    expect(ob.singlePro).toBe(true);
    expect(ob.actAs).toBe("professional");
    expect(ob.listAs).toBe("location");
    expect(ob.formFields).toEqual(pro.formFields);
    expect(ob.claim.keys).toEqual(pro.claim.keys);
    expect(ob.claim.keys.some((k) => k.key === "credential_id")).toBe(true);
  });

  test("single_pro lists as the location (NAP keys + location-ring collections)", () => {
    const ob = entityBriefForOffice(insurance, "single_pro", "professional")!;
    expect(ob.napKeys.map((k) => k.schemaProperty)).toEqual(["name", "address", "telephone"]);
    expect(ob.claim.listingKeys).toEqual(loc.identityKeys);
    expect(ob.claim.listingEntityType).toBe("location");
    expect(ob.listingCollections.length).toBeGreaterThan(0);
    for (const c of ob.listingCollections) {
      expect(c.sourceEntityType).toBe("location");
      expect(c.rings.every((r) => r === "location")).toBe(true);
    }
    // hours come from the location, not the professional; everything else stays the pro's
    const hours = ob.collections.filter((c) => c.key === "hours");
    expect(hours.length).toBe(1);
    expect(hours[0].sourceEntityType).toBe("location");
    expect(
      ob.collections
        .filter((c) => c.key !== "hours")
        .every((c) => c.sourceEntityType === "professional"),
    ).toBe(true);
    expect(ob.collections.find((c) => c.key === "credentials")?.sourceEntityType).toBe("professional");
  });

  test("other modes return the requested entity type unchanged", () => {
    const ob = entityBriefForOffice(insurance, "multi_pro", "location")!;
    expect(ob.singlePro).toBe(false);
    expect(ob.actAs).toBe("location");
    expect(ob.listAs).toBe("location");
    expect(ob.formFields).toEqual(loc.formFields);
    expect(ob.collections.map((c) => c.key)).toEqual(loc.collections.map((c) => c.key));
  });

  test("a category without professionals never fuses (data, not gcid)", () => {
    const ob = entityBriefForOffice(restaurant, "single_pro", "location")!;
    expect(ob.singlePro).toBe(false);
    expect(ob.actAs).toBe("location");
  });
});

describe("listings subject + NAP source", () => {
  const record = { entityType: "professional" as const, entityId: GREG.professional_id };

  test("single_pro: listings resolve to the location", () => {
    expect(listingSubject(record, parseOfficeMode(GREG))).toEqual({
      entityType: "organization",
      entityId: GREG.location_id,
      reason: "single_pro_location",
    });
  });

  test("other modes / unknown mode: the record lists as itself", () => {
    expect(listingSubject(record, null).entityId).toBe(GREG.professional_id);
    const naf = { entityType: "organization" as const, entityId: NAF_OFFICE.location_id };
    expect(listingSubject(naf, parseOfficeMode(NAF_OFFICE))).toEqual({ ...naf, reason: "self" });
  });

  test("single_pro NAP comes from the location; missing fields fall back to the pro (never the name)", () => {
    const nap = listingNap({
      record,
      mode: parseOfficeMode(GREG),
      self: null,
      location: { name: "Greg Aldridge - State Farm Insurance Agent", phone: "(316) 555-0100", address_city: "Wichita", address_state: "KS" },
      professional: { display_name: "Greg Aldridge", phone: "(316) 555-0199", gbp_place_id: "ChIJ-pro", address_zip: "67206" },
    });
    expect(nap.subject.entityType).toBe("organization");
    expect(nap.fields.name).toBe("Greg Aldridge - State Farm Insurance Agent");
    expect(nap.source.name).toBe("location");
    expect(nap.fields.telephone).toBe("(316) 555-0100");
    expect(nap.source.telephone).toBe("location");
    expect(nap.fields.placeId).toBe("ChIJ-pro");
    expect(nap.source.placeId).toBe("professional");
    expect(nap.fields.postalCode).toBe("67206");
  });

  test("non single-pro NAP is the record's own row", () => {
    const nap = listingNap({ record, mode: null, self: { display_name: "Pat Agent", phone: "1" } });
    expect(nap.fields).toEqual({ name: "Pat Agent", telephone: "1" });
    expect(nap.source.name).toBe("self");
  });
});
