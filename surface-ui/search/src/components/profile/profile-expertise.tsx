import { BadgeCheck, ExternalLink, Network, Orbit } from "lucide-react";
import { Card, Empty, Section } from "@v3/search/components/profile/profile-parts";
import type {
  ProfileBundle,
  ProofNode,
  ProofRing,
} from "@v3/search/utils/profile-render";

const SOFT_TARGET = 10;
const NEUTRAL_RING = "var(--color-ink-3)";

function ringColor(ring: ProofRing) {
  return ring.color?.trim() || NEUTRAL_RING;
}

function nodeCount(b: ProfileBundle, ringKey: string) {
  return b.expertise?.nodes.filter((node) => node.ring_key === ringKey).length ?? 0;
}

function displayValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const values = value.filter(
      (item): item is string | number => typeof item === "string" || typeof item === "number",
    );
    return values.length ? values.join(", ") : null;
  }
  return null;
}

function nodeDetails(node: ProofNode) {
  const data = node.extracted_data ?? {};
  const preferred = ["description", "number", "state", "rating", "review_count", "name"];
  const ordered = [
    ...preferred.filter((key) => key in data),
    ...Object.keys(data).filter((key) => !preferred.includes(key)),
  ];
  const seen = new Set<string>();
  return ordered
    .filter((key) => !["url", "raw", "primary"].includes(key))
    .map((key) => ({ key, value: displayValue(data[key]) }))
    .filter((row): row is { key: string; value: string } => {
      if (!row.value || seen.has(row.value)) return false;
      seen.add(row.value);
      return true;
    })
    .slice(0, 3);
}

function Provenance({ node }: { node: ProofNode }) {
  if (!node.verified && node.ring_key !== "credentials") return null;
  if (node.verified) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
        <BadgeCheck className="h-3 w-3" /> verified · source: {node.source}
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full border border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] px-2 py-0.5 text-[10px] text-[color:var(--color-ink-3)]">
      self-reported · source: {node.source}
    </span>
  );
}

function ExperienceScore({ b }: { b: ProfileBundle }) {
  const rings = b.expertise?.rings ?? [];
  return (
    <Section id="experience-score" eyebrow="Live proof graph" title="Experience Score">
      <Card>
        <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-center">
          <div className="rounded-2xl border border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] p-5 text-center">
            <div className="mx-auto grid h-24 w-24 place-items-center rounded-full border-8 border-[color:var(--color-surface-3)] bg-white">
              <div>
                <div className="text-sm font-semibold text-ink">Score pending</div>
                <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[color:var(--color-ink-3)]">
                  Computing
                </div>
              </div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-[color:var(--color-ink-3)]">
              Ring coverage is live. The overall score is not calculated yet.
            </p>
          </div>
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {rings.map((ring) => {
              const count = nodeCount(b, ring.ring_key);
              const width = Math.min(100, (count / SOFT_TARGET) * 100);
              return (
                <div key={ring.ring_key}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2 font-medium text-ink">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: ringColor(ring) }}
                      />
                      <span className="truncate">{ring.display_name}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-[color:var(--color-ink-3)]">
                      {count} {count === 1 ? "node" : "nodes"}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[color:var(--color-surface-3)]">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${width}%`, backgroundColor: ringColor(ring) }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </Section>
  );
}

function ExpertiseOrbit({ b }: { b: ProfileBundle }) {
  const rings = b.expertise?.rings ?? [];
  const nodes = b.expertise?.nodes ?? [];
  const center = 230;
  const radii = rings.map((_, index) => 42 + index * 23);
  return (
    <Section id="expertise-graph" eyebrow="Structured evidence" title="Expertise Graph">
      <Card className="overflow-hidden p-4 sm:p-6">
        <div className="mx-auto max-w-[560px]" data-node-count={nodes.length}>
          <svg
            viewBox="0 0 460 460"
            role="img"
            aria-label={`${b.identity.name} expertise graph with ${nodes.length} live nodes`}
            className="h-auto w-full"
          >
            <circle cx={center} cy={center} r="214" fill="var(--color-surface-2)" />
            {rings.map((ring, index) => (
              <circle
                key={ring.ring_key}
                cx={center}
                cy={center}
                r={radii[index]}
                fill="none"
                stroke={ringColor(ring)}
                strokeOpacity="0.36"
                strokeWidth="1.25"
              />
            ))}
            {rings.flatMap((ring, ringIndex) => {
              const ringNodes = nodes.filter((node) => node.ring_key === ring.ring_key);
              const radius = radii[ringIndex] ?? 42;
              return ringNodes.map((node, nodeIndex) => {
                const angle = -Math.PI / 2 + (Math.PI * 2 * nodeIndex) / Math.max(ringNodes.length, 1);
                const x = center + Math.cos(angle) * radius;
                const y = center + Math.sin(angle) * radius;
                return (
                  <circle
                    key={node.id}
                    cx={x}
                    cy={y}
                    r={node.verified ? 5 : 4}
                    fill={ringColor(ring)}
                    stroke="white"
                    strokeWidth="1.5"
                  >
                    <title>{node.title ?? node.node_type.replace(/_/g, " ")}</title>
                  </circle>
                );
              });
            })}
            <circle cx={center} cy={center} r="31" fill="var(--color-g-blue)" />
            <Orbit x={center - 10} y={center - 10} width="20" height="20" color="white" />
            <text
              x={center}
              y={center + 48}
              textAnchor="middle"
              className="fill-[color:var(--color-ink)] text-[11px] font-semibold"
            >
              {b.identity.name.length > 34 ? `${b.identity.name.slice(0, 32)}…` : b.identity.name}
            </text>
          </svg>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {rings.map((ring) => {
            const count = nodeCount(b, ring.ring_key);
            return (
              <div
                key={ring.ring_key}
                className="flex items-center justify-between gap-2 rounded-xl border border-[color:var(--color-hairline)] px-3 py-2 text-xs"
              >
                <span className="flex min-w-0 items-center gap-2 text-[color:var(--color-ink-2)]">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: ringColor(ring) }}
                  />
                  <span className="truncate">{ring.display_name}</span>
                </span>
                <span className="font-semibold tabular-nums text-ink">{count}</span>
              </div>
            );
          })}
        </div>
      </Card>
    </Section>
  );
}

function ringTitle(b: ProfileBundle, ring: ProofRing) {
  if (ring.ring_key === "credentials") return b.config.credential_label;
  if (ring.ring_key === "services") return b.config.service_label;
  return ring.display_name;
}

function RingSections({ b }: { b: ProfileBundle }) {
  const rings = b.expertise?.rings ?? [];
  const nodes = b.expertise?.nodes ?? [];
  return (
    <>
      {rings.map((ring) => {
        const items = nodes.filter((node) => node.ring_key === ring.ring_key);
        if (!items.length) return null;
        return (
          <Section
            key={ring.ring_key}
            id={`ring-${ring.ring_key}`}
            eyebrow={`${items.length} live ${items.length === 1 ? "node" : "nodes"}`}
            title={ringTitle(b, ring)}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((node) => {
                const details = nodeDetails(node);
                const content = (
                  <Card className="h-full p-4">
                    <div className="flex items-start gap-3">
                      <span
                        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: ringColor(ring) }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-semibold leading-snug text-ink">
                            {node.title ?? node.node_type.replace(/_/g, " ")}
                          </h3>
                          {node.url ? (
                            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-ink-3)]" />
                          ) : null}
                        </div>
                        {details.map((detail) => (
                          <p
                            key={`${node.id}-${detail.key}`}
                            className="mt-1 text-xs leading-relaxed text-[color:var(--color-ink-3)]"
                          >
                            {detail.key === "description" ? "" : `${detail.key.replace(/_/g, " ")}: `}
                            {detail.value}
                          </p>
                        ))}
                        <div className="mt-3">
                          <Provenance node={node} />
                        </div>
                      </div>
                    </div>
                  </Card>
                );
                return node.url ? (
                  <a
                    key={node.id}
                    href={node.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="block rounded-3xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--color-g-blue)]/20"
                  >
                    {content}
                  </a>
                ) : (
                  <div key={node.id}>{content}</div>
                );
              })}
            </div>
          </Section>
        );
      })}
    </>
  );
}

function TrustedNetwork({ b }: { b: ProfileBundle }) {
  const partners = b.expertise?.trustedPartners ?? [];
  return (
    <Section id="trusted-network" eyebrow="Verified relationships" title="Trusted Network">
      {partners.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {partners.map((partner) => (
            <Card key={partner.id} className="p-4">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]">
                  <Network className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-ink">{partner.partner_name}</h3>
                  <p className="mt-1 text-xs text-[color:var(--color-ink-3)]">
                    {[partner.relationship_type, partner.status].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Empty>No verified partners yet.</Empty>
      )}
    </Section>
  );
}

export function ProfileExpertise({ b }: { b: ProfileBundle }) {
  if (!b.expertise) return null;
  return (
    <div className="space-y-12">
      <ExperienceScore b={b} />
      <ExpertiseOrbit b={b} />
      <RingSections b={b} />
      <TrustedNetwork b={b} />
    </div>
  );
}