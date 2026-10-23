import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type OsmPin = {
  id: string;
  lat: number;
  lng: number;
  name: string;
  subtitle?: string | null;
  href?: string | null;
  color: string;
  label?: string | null;
  approximate?: boolean;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

function pinIcon(pin: OsmPin, active: boolean) {
  const size = active ? 30 : pin.label ? 26 : 18;
  const text = pin.label
    ? `<span style="font:700 11px/1 ui-sans-serif,system-ui;color:#0b1220">${escapeHtml(pin.label)}</span>`
    : "";
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<span style="display:grid;place-items:center;width:${size}px;height:${size}px;border-radius:50%;background:${pin.color};border:2px solid #fff;box-shadow:0 2px 6px rgba(6,12,24,.45)${pin.approximate ? ";opacity:.85" : ""}">${text}</span>`,
  });
}

/**
 * Keyless map: Leaflet with OpenStreetMap tiles. No API key or account is
 * needed, so pins render immediately. Pins are coloured by business type and
 * open a mini detail popover that links to the profile.
 */
export default function OsmMap({
  pins,
  selected,
  onSelect,
  className,
  zoomControl = true,
}: {
  pins: OsmPin[];
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  className?: string;
  zoomControl?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    if (!host.current || map.current) return;
    const instance = L.map(host.current, {
      zoomControl,
      scrollWheelZoom: true,
      attributionControl: true,
    }).setView([39.8, -98.5], 4);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(instance);
    map.current = instance;
    // The container is often measured before layout settles inside cards.
    window.setTimeout(() => instance.invalidateSize(), 60);
    return () => {
      instance.remove();
      map.current = null;
      markers.current.clear();
    };
  }, [zoomControl]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    for (const marker of markers.current.values()) marker.remove();
    markers.current.clear();
    if (pins.length === 0) return;

    for (const pin of pins) {
      const marker = L.marker([pin.lat, pin.lng], {
        icon: pinIcon(pin, pin.id === selected),
        title: pin.name,
        keyboard: true,
        alt: pin.name,
      })
        .addTo(instance)
        .bindPopup(
          `<div style="min-width:170px">
             <div style="font:600 13px/1.3 ui-sans-serif,system-ui;color:#0b1220">${escapeHtml(pin.name)}</div>
             ${pin.subtitle ? `<div style="margin-top:2px;font:400 12px/1.35 ui-sans-serif,system-ui;color:#64748b">${escapeHtml(pin.subtitle)}</div>` : ""}
             ${pin.approximate ? `<div style="margin-top:2px;font:400 11px/1.3 ui-sans-serif,system-ui;color:#94a3b8">Approximate location (city centre)</div>` : ""}
             ${pin.href ? `<a href="${escapeHtml(pin.href)}" style="display:inline-block;margin-top:6px;font:600 12px/1.3 ui-sans-serif,system-ui;color:#92400e">View profile →</a>` : ""}
           </div>`,
          { closeButton: true },
        );
      marker.on("click", () => select.current?.(pin.id));
      markers.current.set(pin.id, marker);
    }

    const bounds = L.latLngBounds(pins.map((pin) => [pin.lat, pin.lng] as [number, number]));
    instance.fitBounds(bounds.pad(0.25), { maxZoom: pins.length === 1 ? 13 : 15 });
  }, [pins, selected]);

  useEffect(() => {
    const marker = selected ? markers.current.get(selected) : null;
    if (marker) marker.openPopup();
  }, [selected]);

  return <div ref={host} className={className} aria-label="Map of results" role="application" />;
}
