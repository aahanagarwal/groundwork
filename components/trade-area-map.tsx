"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { circleRing, polygon as toPolygon } from "@/lib/geo";

/**
 * Point MapLibre at a worker we serve ourselves.
 *
 * MapLibre tiles GeoJSON sources inside a web worker. Under Turbopack the
 * worker's own module URL does not resolve in dev: the request falls through
 * to the app router and returns HTML, the worker never boots, and the failure
 * is partial in the worst way - raster tiles keep painting on the main thread
 * so the map looks healthy, while every GeoJSON source stays empty. In this
 * app that means the drive-time polygon, the entire reason the map exists,
 * quietly does not draw.
 *
 * scripts/copy-maplibre-worker.mjs puts the worker and its shared chunk in
 * public/maplibre/ (wired to predev/prebuild), so this bypasses the bundler.
 */
maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

/**
 * THE TRADE AREA MAP
 *
 * Two jobs, and they are the same argument told twice:
 *
 *   1. Show the real drive shed against the circle an ad tool would have
 *      bought, so the gap is a picture rather than a claim.
 *   2. Show who else is standing inside that shed, and what the engine
 *      concluded each of them actually cost - not what a plausible-looking
 *      formula could produce.
 *
 * The circle is a dashed outline with no fill: it is the claim being refuted,
 * not a layer of information. The polygon is filled ultramarine because it is
 * the thing being measured.
 *
 * Rules this file has had to learn the hard way:
 *
 *   - Sources are UPSERTED, never added-once. Scenario switches keep this
 *     component mounted and only change props; an add-once guard meant the
 *     map kept the first scenario's geometry for the life of the page while
 *     the markers around it changed, which is worse than showing nothing.
 *   - Competitor catchments are drawn as real geodesic rings in metres, not
 *     as `circle-radius` in pixels. A pixel radius is a screen artifact that
 *     changes size as you zoom and corresponds to no distance on the ground;
 *     on a product whose whole pitch is measured geography, that is a lie
 *     with a legend next to it.
 *   - Every number in a popup comes from the attribution engine or from the
 *     scenario record. Nothing here derives a dollar figure of its own.
 */

export interface DriverImpactView {
  customers: number;
  customersLow: number;
  customersHigh: number;
  marginUsd: number;
  activeDays: number;
  certainty: "confirmed" | "likely" | "unproven";
  certaintyReason: string;
}

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  kind: "closure" | "competitor" | "permit" | "site" | "event";
  label: string;
  /** Pins outside the polygon draw hollow - considered, then discarded. */
  insidePolygon: boolean;
  /** Why it was kept or dropped, straight from the pipeline. */
  membershipReason?: string;
  /** Straight-line metres from the site, as the pipeline measured it. */
  distanceM?: number | null;
  /**
   * How far this driver is by road. Preferred over `distanceM` wherever it is
   * present and routed - a straight line across a closed bridge is not a
   * distance anyone can drive. Labelled either way, never silently swapped.
   */
  driveTime?: {
    minutes: number | null;
    miles: number | null;
    method: "mireye_distance" | "haversine";
  } | null;
  /** Rich metadata for interactive popups */
  meta?: Record<string, unknown>;
  /**
   * Set when the engine could not size this driver for a structural reason -
   * typically that it predates the till data and never ends, which makes it
   * part of the baseline rather than a movement against it.
   */
  unidentifiableReason?: string;
  /**
   * What the attribution engine concluded about this specific driver.
   * Absent when the engine could not measure it separately - in which case
   * the popup says exactly that instead of guessing.
   */
  impact?: DriverImpactView | null;
}

/**
 * Auto-bold proper nouns in popup text: street names, place names,
 * business names, and other key terms a business owner should notice.
 */
function boldTerms(text: string): string {
  // Bold street/road names: "S Congress Ave", "Elizabeth St", "Menchaca Rd"
  const streetPattern =
    /\b([NSEW]\s+)?([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)*)\s+(Ave|St|Rd|Blvd|Dr|Ln|Ct|Way|Pkwy|Hwy|Loop)\b/g;
  text = text.replace(streetPattern, (match) => `<b>${match}</b>`);

  // Bold venue/place names like "Q2 Stadium", "ACL Festival"
  const venuePattern =
    /\b([A-Z][A-Z0-9]+\s+(?:Stadium|Arena|Center|Park|Festival|Plaza))\b/g;
  return text.replace(venuePattern, (match) => `<b>${match}</b>`);
}

/**
 * Popup bodies interpolate scenario metadata, and in production that metadata
 * comes from Places/permit feeds rather than a file we wrote. `setHTML` would
 * execute anything a feed put in a business name, so every interpolated value
 * goes through here first and only our own markup survives.
 */
function esc(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

const COLORS = {
  ink: "#14201C",
  survey: "#2C5F52",
  ultra: "#2438C8",
  signal: "#EBDD3C",
  threat: "#C2321F",
};

const money = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString()}`;

/**
 * How far away, said the most truthful way the data allows.
 *
 * A routed drive time is the answer this product is actually about, so it wins
 * whenever we have one. When we do not, the straight line is shown with "as
 * the crow flies" attached rather than dressed up as a travel time - the whole
 * point of the polygon next to it is that those two are not the same number.
 */
function distanceLabel(pin: MapPin): { short: string; long: string } | null {
  const dt = pin.driveTime;
  if (dt?.method === "mireye_distance" && dt.minutes !== null) {
    const miles = dt.miles !== null ? `${dt.miles.toFixed(1)} mi` : null;
    return {
      short: `${dt.minutes.toFixed(0)} min drive`,
      long: [`${dt.minutes.toFixed(0)} min drive`, miles].filter(Boolean).join(" · "),
    };
  }
  const miles =
    dt?.miles ?? (pin.distanceM != null ? pin.distanceM / 1609.344 : null);
  if (miles === null) return null;
  const short = miles < 0.6 ? `${Math.round(miles * 1609.344)}m` : `${miles.toFixed(1)} mi`;
  return { short, long: `${short} as the crow flies` };
}

const CERTAINTY_COPY: Record<
  DriverImpactView["certainty"],
  { label: string; color: string }
> = {
  confirmed: { label: "Confirmed", color: "#166534" },
  likely: { label: "Likely", color: "#A16207" },
  unproven: { label: "Unproven", color: "#57534E" },
};

/**
 * The catchment a competitor plausibly takes off you, drawn on the ground.
 *
 * Scaled off the walk-in distance the record carries so it is at least a real
 * measurement rather than a decorative blob, and clamped so one distant
 * outlier cannot swallow the frame. It is labelled as an estimate in the
 * legend because that is what it is.
 */
function catchmentRadiusM(distanceM: number | null | undefined): number {
  if (!distanceM || !Number.isFinite(distanceM)) return 250;
  return Math.max(150, Math.min(500, distanceM / 2));
}

export function TradeAreaMap({
  center,
  polygon,
  naiveCircle,
  parcel,
  pins = [],
  minutes,
  naiveRadiusMiles,
}: {
  center: { lat: number; lng: number };
  polygon: GeoJSON.Polygon | null;
  naiveCircle: GeoJSON.Polygon | null;
  parcel?: GeoJSON.Geometry | null;
  pins?: MapPin[];
  minutes: number;
  naiveRadiusMiles: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const popups = useRef(new Map<string, maplibregl.Popup>());
  const [showCircle, setShowCircle] = useState(true);
  const [tilted, setTilted] = useState(false);
  const [ready, setReady] = useState(false);
  const [basemapFailed, setBasemapFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  /** Set by the draw effect so the resize observer can re-fit the view. */
  const refit = useRef<(() => void) | null>(null);

  // The roster lists rivals that actually reach this address. One that was
  // rejected for falling outside the shed belongs in the discarded section
  // below it and nowhere else - listing it in both places would show the same
  // competitor twice and describe it two different ways.
  const competitors = useMemo(
    () => pins.filter((p) => p.kind === "competitor" && p.insidePolygon),
    [pins],
  );
  const discarded = useMemo(() => pins.filter((p) => !p.insidePolygon), [pins]);

  /**
   * CONTENT SIGNATURES, NOT OBJECT IDENTITIES
   *
   * These props arrive from a server component, and their identity is fresh on
   * every render even when nothing about them has changed. Keying the draw
   * effect on identity therefore re-ran it on every render - measured at ~10
   * times a second while the page sat completely idle - and each run tore down
   * every marker and rebuilt it.
   *
   * That is what made the map feel frozen. It was not stuck; it was being
   * rebuilt faster than it could be used, and a popup opened by a click was
   * destroyed a frame later by the next rebuild, which is why competitors could
   * not be inspected at all.
   *
   * Comparing content instead means the effect runs when the geometry or the
   * pins actually differ, and not otherwise. The payloads are small - an
   * isochrone ring is a couple of dozen coordinates - so stringifying them is
   * far cheaper than the teardown it prevents.
   */
  const polygonKey = useMemo(() => JSON.stringify(polygon), [polygon]);
  const naiveKey = useMemo(() => JSON.stringify(naiveCircle), [naiveCircle]);
  const parcelKey = useMemo(() => JSON.stringify(parcel), [parcel]);
  const pinsKey = useMemo(
    () =>
      pins
        .map((p) =>
          [
            p.id,
            p.lat,
            p.lng,
            p.kind,
            p.insidePolygon,
            p.impact?.customers ?? "",
            p.impact?.certainty ?? "",
          ].join(","),
        )
        .join("|"),
    [pins],
  );

  // --- 1. Create the map, once ---------------------------------------------
  // Empty deps on purpose: one address per page, so the centre never changes
  // for the life of this component. Re-creating the map on every prop identity
  // change is what stacked orphaned instances on the same container.
  useEffect(() => {
    if (map.current || !container.current) return;

    const instance = new maplibregl.Map({
      container: container.current,
      style: {
        version: 8,
        sources: {
          basemap: {
            type: "raster",
            tiles: [
              "https://a.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}@2x.png",
              "https://b.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}@2x.png",
            ],
            tileSize: 256,
            attribution:
              '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
          },
        },
        layers: [{ id: "basemap", type: "raster", source: "basemap" }],
      },
      center: [center.lng, center.lat],
      zoom: 11.4,
      // Flat by default. The comparison this map exists to make is between two
      // AREAS, and tilting the camera shrinks whatever is furthest from the
      // viewer - which makes the polygon look smaller relative to the circle
      // for reasons that have nothing to do with the data. Tilt is available
      // on a button for people who want the view, not baked into the argument.
      pitch: 0,
      bearing: 0,
      attributionControl: { compact: true },
    });

    map.current = instance;

    // Development-only handle. Verifying that an overlay actually reached the
    // map otherwise means squinting at a screenshot, and a faint fill over a
    // grey basemap is exactly the thing a screenshot cannot settle.
    if (process.env.NODE_ENV === "development") {
      (window as unknown as Record<string, unknown>).__groundworkMap = instance;
    }

    // Readiness must NOT depend on the basemap.
    //
    // `load` and `idle` both wait on tiles, so when the tile CDN is
    // unreachable neither ever fires and the overlay silently never draws.
    // `styledata` fires as soon as the style JSON is parsed, which is all that
    // is actually required to add a source and a layer.
    const markReady = () => setReady(true);
    if (instance.loaded()) markReady();
    instance.on("styledata", markReady);
    instance.on("load", markReady);
    instance.on("idle", markReady);

    instance.on("error", (event) => {
      const message = event?.error?.message ?? "";
      // A failed basemap tile is not worth shouting about - it is expected
      // offline, and the overlay is unaffected. Say it once.
      if (/basemaps\.cartocdn|Failed to fetch/.test(message)) {
        setBasemapFailed(true);
        return;
      }
      console.error("[map]", message || event);
    });

    // MapLibre applies its style inside a requestAnimationFrame callback, and
    // rAF does not run in a hidden document. A map constructed while the tab
    // is backgrounded therefore parks with no stylesheet and never recovers on
    // its own: `load`, `idle` and `styledata` have all not fired yet and never
    // will, so the polygon, the markers and the whole overlay stay absent even
    // after the tab comes back. Nudging it on visibilitychange is what turns
    // that permanent freeze into a one-frame delay.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      instance.resize();
      if (instance.loaded()) setReady(true);
    };
    document.addEventListener("visibilitychange", onVisible);

    // The map is created before the surrounding grid has settled its final
    // height, so MapLibre measures a container smaller than the one it ends up
    // in - and then fits bounds to the wrong size and never revisits it.
    //
    // Re-fitting only when the box actually changed size matters as much as
    // re-fitting at all: this map lives in a tab that toggles display, so the
    // observer fires every time the user comes back. Re-fitting unconditionally
    // there would throw away whatever they had navigated to - including the
    // competitor they just clicked in the roster.
    let lastW = 0;
    let lastH = 0;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width === 0 || height === 0) return;
      instance.resize();
      if (Math.abs(width - lastW) < 1 && Math.abs(height - lastH) < 1) return;
      lastW = width;
      lastH = height;
      refit.current?.();
    });
    observer.observe(container.current);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      observer.disconnect();
      instance.remove();
      map.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- 2. Draw the overlay --------------------------------------------------
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;

    /**
     * Add on first sight, update in place afterwards.
     *
     * The update half is the point: switching scenarios re-renders this
     * component with new geometry but never unmounts it, so an add-once guard
     * pinned the map to whatever the first scenario happened to be.
     */
    const upsert = (
      id: string,
      data: GeoJSON.Feature | GeoJSON.FeatureCollection,
      layers: maplibregl.LayerSpecification[],
    ) => {
      const existing = instance.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(data);
        return;
      }
      instance.addSource(id, { type: "geojson", data });
      for (const layer of layers) {
        if (!instance.getLayer(layer.id)) instance.addLayer(layer);
      }
    };

    const feature = (geometry: GeoJSON.Geometry): GeoJSON.Feature => ({
      type: "Feature",
      geometry,
      properties: {},
    });

    const drop = (sourceId: string, layerIds: string[]) => {
      for (const l of layerIds) if (instance.getLayer(l)) instance.removeLayer(l);
      if (instance.getSource(sourceId)) instance.removeSource(sourceId);
    };

    // Competitor catchments, in real metres on the ground, drawn first so the
    // trade-area geometry reads over the top of them.
    if (competitors.length > 0) {
      upsert(
        "competitor-threat",
        {
          type: "FeatureCollection",
          features: competitors.map((p) => ({
            type: "Feature" as const,
            geometry: toPolygon(
              circleRing({ lat: p.lat, lng: p.lng }, catchmentRadiusM(p.distanceM) / 1609.344, 64),
            ),
            properties: { id: p.id },
          })),
        },
        [
          {
            id: "threat-fill",
            type: "fill",
            source: "competitor-threat",
            paint: { "fill-color": COLORS.threat, "fill-opacity": 0.1 },
          },
          {
            id: "threat-line",
            type: "line",
            source: "competitor-threat",
            paint: {
              "line-color": COLORS.threat,
              "line-width": 1,
              "line-opacity": 0.5,
              "line-dasharray": [2, 2],
            },
          },
        ],
      );
    } else {
      drop("competitor-threat", ["threat-fill", "threat-line"]);
    }

    // Circle next, so the polygon draws over it.
    if (naiveCircle) {
      upsert("naive", feature(naiveCircle), [
        {
          id: "naive-line",
          type: "line",
          source: "naive",
          paint: {
            "line-color": COLORS.ink,
            "line-width": 1.5,
            "line-dasharray": [3, 3],
            "line-opacity": 0.65,
          },
        },
      ]);
    } else {
      drop("naive", ["naive-line"]);
    }

    if (polygon) {
      upsert("shed", feature(polygon), [
        {
          id: "shed-fill",
          type: "fill",
          source: "shed",
          paint: { "fill-color": COLORS.ultra, "fill-opacity": 0.2 },
        },
        {
          id: "shed-line",
          type: "line",
          source: "shed",
          paint: { "line-color": COLORS.ultra, "line-width": 2.5 },
        },
      ]);
    } else {
      drop("shed", ["shed-fill", "shed-line"]);
    }

    if (parcel) {
      upsert("parcel", feature(parcel), [
        {
          id: "parcel-line",
          type: "line",
          source: "parcel",
          paint: { "line-color": COLORS.survey, "line-width": 2 },
        },
      ]);
    } else {
      drop("parcel", ["parcel-line"]);
    }

    // Markers are recreated per run, so they get their own cleanup.
    const markers: maplibregl.Marker[] = [];
    // Bound once so the cleanup closes over the same map this run populated,
    // rather than whatever the ref happens to hold when it eventually fires.
    const openPopups = popups.current;
    openPopups.clear();

    const siteEl = document.createElement("div");
    siteEl.style.cssText = `width:16px;height:16px;background:${COLORS.signal};border:3px solid ${COLORS.ink};border-radius:50%;box-shadow:0 4px 10px rgba(0,0,0,0.3);`;
    siteEl.title = "This address";
    markers.push(
      new maplibregl.Marker({ element: siteEl })
        .setLngLat([center.lng, center.lat])
        .addTo(instance),
    );

    for (const pin of pins) {
      const el = document.createElement("div");
      const m = pin.meta ?? {};
      let popupHtml: string;
      let offset = 12;

      if (pin.kind === "competitor") {
        el.style.cssText =
          "position:relative;width:28px;height:28px;cursor:pointer;";
        el.title = pin.label;

        // The pulse marks a live rival, and it is the one thing on this map
        // that moves - so it is also the thing that will annoy anyone reading
        // for a while. Honour the OS-level preference instead of overriding it.
        const still = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
        if (!still) {
          const pulse = document.createElement("div");
          pulse.style.cssText = `position:absolute;inset:0;border-radius:50%;background:${COLORS.threat};opacity:0.3;animation:ping 1.8s cubic-bezier(0,0,0.2,1) infinite;`;
          el.appendChild(pulse);
        }

        const dot = document.createElement("div");
        dot.style.cssText = `position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:14px;height:14px;background:${COLORS.threat};border:2.5px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(194,50,31,0.5);z-index:2;`;
        el.appendChild(dot);

        popupHtml = competitorPopup(pin, m, minutes);
        offset = 16;
      } else if (pin.kind === "closure") {
        el.style.cssText =
          `width:14px;height:14px;border:2.5px solid ${COLORS.ultra};cursor:pointer;` +
          `border-radius:2px;background:${pin.insidePolygon ? COLORS.ultra : "transparent"};` +
          `box-shadow:0 2px 6px rgba(36,56,200,0.3);`;
        el.title = pin.label;
        popupHtml = closurePopup(pin, m);
      } else {
        const color = pin.insidePolygon ? COLORS.survey : "#9A9A93";
        el.style.cssText =
          `width:12px;height:12px;border:2px solid ${color};` +
          `border-radius:50%;cursor:pointer;` +
          `background:${pin.insidePolygon ? color : "transparent"};`;
        el.title = pin.label;
        popupHtml = genericPopup(pin);
      }

      // The anchor is set here rather than left to the marker on purpose. A
      // popup attached with `marker.setPopup` only learns its coordinate when
      // the marker itself opens it, so opening one directly - which is exactly
      // what a roster click does - would otherwise position nothing and appear
      // to do nothing at all.
      const popup = new maplibregl.Popup({
        offset,
        closeButton: true,
        maxWidth: "300px",
        className: "gw-popup",
      })
        .setLngLat([pin.lng, pin.lat])
        .setHTML(popupHtml);

      // A pin outside the shed is evidence of a rejection, so it reads as one:
      // faded, and never pulsing.
      if (!pin.insidePolygon) el.style.opacity = "0.55";

      popup.on("close", () =>
        setSelected((cur) => (cur === pin.id ? null : cur)),
      );
      openPopups.set(pin.id, popup);

      markers.push(
        new maplibregl.Marker({ element: el })
          .setLngLat([pin.lng, pin.lat])
          .setPopup(popup)
          .addTo(instance),
      );
    }

    // Fit to the circle so the contrast is the first thing visible.
    const target = naiveCircle ?? polygon;
    const fit = () => {
      if (!target) return;
      const coords = target.coordinates[0] as [number, number][];
      const bounds = coords.reduce(
        (b, c) => b.extend(c),
        new maplibregl.LngLatBounds(coords[0], coords[0]),
      );
      instance.fitBounds(bounds, { padding: 40, duration: 0 });
    };
    fit();
    refit.current = fit;

    return () => {
      refit.current = null;
      openPopups.clear();
      markers.forEach((mk) => mk.remove());
    };
    // Keyed on content, not identity - see the signatures above. The prop
    // values read inside the effect are the current ones; only the decision to
    // re-run is made from the signatures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, polygonKey, naiveKey, parcelKey, pinsKey, center.lat, center.lng, minutes]);

  // Toggling the circle is a deliberate interaction - it is how a sceptic
  // checks that the polygon isn't a circle with extra steps.
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready || !instance.getLayer("naive-line")) return;
    instance.setLayoutProperty(
      "naive-line",
      "visibility",
      showCircle ? "visible" : "none",
    );
  }, [showCircle, ready]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;
    instance.easeTo({ pitch: tilted ? 50 : 0, bearing: tilted ? -15 : 0, duration: 450 });
  }, [tilted, ready]);

  /** Roster click: fly to the pin and open its popup. */
  const focusPin = useCallback((pin: MapPin) => {
    const instance = map.current;
    if (!instance) return;
    setSelected(pin.id);
    // Sit the pin above centre rather than on it. The popup opens beneath the
    // marker and is the taller of the two, so centring the pin is precisely
    // the framing that pushes the figures off the bottom of the panel.
    instance.flyTo({
      center: [pin.lng, pin.lat],
      zoom: 14.6,
      offset: [0, -90],
      duration: 700,
    });
    const popup = popups.current.get(pin.id);
    if (popup && !popup.isOpen()) popup.addTo(instance);
  }, []);

  const resetView = useCallback(() => {
    setSelected(null);
    for (const p of popups.current.values()) if (p.isOpen()) p.remove();
    refit.current?.();
  }, []);

  return (
    <div className="flex h-full w-full flex-col lg:flex-row">
      <div className="relative min-h-[320px] flex-1">
        <div ref={container} className="h-full w-full" />

        {basemapFailed ? (
          <div className="pointer-events-none absolute bottom-3 right-3 max-w-[240px] border border-stone bg-paper/95 px-2.5 py-1.5 font-mono text-[12.5px] leading-snug text-stone">
            Street map unavailable - no connection. The drive area and the
            circle are drawn from stored geometry and are unaffected.
          </div>
        ) : null}

        <div className="pointer-events-none absolute left-3 top-3 border-[1.5px] border-ink bg-paper/95 px-3 py-2.5">
          <div className="label mb-1.5">Trade area</div>
          <div className="flex items-center gap-2 font-mono text-[12.5px]">
            <span className="inline-block h-2.5 w-4 border-2 border-[#2438C8] bg-[#2438C8]/20" />
            <span>{minutes}-minute drive - measured drive times</span>
          </div>
          <div className="mt-1 flex items-center gap-2 font-mono text-[12.5px] text-ink/60">
            <span className="inline-block h-0 w-4 border-t-2 border-dashed border-ink/60" />
            <span>{naiveRadiusMiles}-mile radius - what an ad tool buys</span>
          </div>
          <div className="mt-2 space-y-1 border-t border-ink/10 pt-2">
            <div className="flex items-center gap-2 font-mono text-[12.5px]">
              <span className="inline-block h-2.5 w-2.5 rounded-full border border-white bg-[#C2321F]" />
              <span>Competitor - click to inspect</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-[12.5px]">
              <span className="inline-block h-2.5 w-2.5 rounded-sm border border-white bg-[#2438C8]" />
              <span>Road closure</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-[12.5px] text-ink/60">
              <span className="inline-block h-2.5 w-2.5 rounded-full border border-dashed border-[#C2321F] bg-[#C2321F]/10" />
              <span>Est. competitor catchment</span>
            </div>
            {discarded.length > 0 ? (
              <div className="flex items-center gap-2 font-mono text-[12.5px] text-ink/60">
                <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-stone bg-transparent" />
                <span>Considered, then discarded</span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="absolute bottom-9 left-3 flex gap-2">
          <button
            type="button"
            onClick={() => setShowCircle((v) => !v)}
            className="border-[1.5px] border-ink bg-paper px-3 py-1.5 font-mono text-[13px] uppercase tracking-widest hover:bg-limestone"
          >
            {showCircle ? "Hide" : "Show"} the circle
          </button>
          <button
            type="button"
            onClick={() => setTilted((v) => !v)}
            className="border-[1.5px] border-ink bg-paper px-3 py-1.5 font-mono text-[13px] uppercase tracking-widest hover:bg-limestone"
          >
            {tilted ? "Flat" : "3D"}
          </button>
        </div>
      </div>

      <CompetitorRoster
        competitors={competitors}
        discarded={discarded}
        selected={selected}
        minutes={minutes}
        onFocus={focusPin}
        onReset={resetView}
      />
    </div>
  );
}

/**
 * THE ROSTER
 *
 * A map of pins answers "where are they". It does not answer "who are they and
 * which one is actually hurting me", because that requires comparing pins, and
 * comparing pins means clicking each one and holding the last in your head.
 * The list does the comparing: sorted by measured impact, with the engine's
 * own certainty grade attached, and clicking a row drives the map.
 */
function CompetitorRoster({
  competitors,
  discarded,
  selected,
  minutes,
  onFocus,
  onReset,
}: {
  competitors: MapPin[];
  discarded: MapPin[];
  selected: string | null;
  minutes: number;
  onFocus: (pin: MapPin) => void;
  onReset: () => void;
}) {
  // Biggest measured loss first; anything the engine could not size sinks to
  // the bottom rather than being ranked on a number it does not have.
  const ordered = useMemo(
    () =>
      [...competitors].sort((a, b) => {
        const av = a.impact ? Math.abs(a.impact.customers) : -1;
        const bv = b.impact ? Math.abs(b.impact.customers) : -1;
        return bv - av;
      }),
    [competitors],
  );

  const measured = ordered.filter((c) => c.impact && c.impact.certainty !== "unproven");
  const totalCustomers = measured.reduce((s, c) => s + (c.impact?.customers ?? 0), 0);
  const totalMargin = measured.reduce((s, c) => s + (c.impact?.marginUsd ?? 0), 0);

  return (
    <aside className="flex w-full shrink-0 flex-col border-t-[1.5px] border-ink bg-paper lg:w-[330px] lg:border-l-[1.5px] lg:border-t-0">
      <header className="border-b border-rule px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-display text-[15px] font-bold uppercase tracking-wide text-ink">
            Who else is in your {minutes}-min shed
          </h3>
          {selected ? (
            <button
              type="button"
              onClick={onReset}
              className="font-mono text-[13px] uppercase tracking-widest text-ink/50 underline hover:text-ink"
            >
              Reset
            </button>
          ) : null}
        </div>
        <p className="mt-1 font-mono text-[13px] leading-snug text-ink/60">
          {competitors.length === 0
            ? "No competitors inside the drive polygon for this scenario."
            : measured.length === 0
              ? `${competitors.length} nearby, none separately measurable in this window.`
              : `${measured.length} of ${competitors.length} measurable - together ${totalCustomers <= 0 ? "costing" : "worth"} ${Math.abs(Math.round(totalCustomers))} customers and ${money(Math.abs(totalMargin))} of margin.`}
        </p>
      </header>

      <div className="max-h-[420px] flex-1 divide-y divide-rule overflow-y-auto lg:max-h-none">
        {ordered.map((c) => {
          const meta = c.meta ?? {};
          const name = (meta["businessName"] as string) || c.label;
          const cert = c.impact ? CERTAINTY_COPY[c.impact.certainty] : null;
          const isSel = selected === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onFocus(c)}
              className={`block w-full px-4 py-3 text-left transition-colors ${
                isSel ? "bg-limestone" : "hover:bg-limestone/60"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-display text-[14px] font-bold leading-tight text-ink">
                  {name}
                </span>
                {distanceLabel(c) ? (
                  <span
                    className="shrink-0 font-mono text-[13px] tabular text-ink/50"
                    title={distanceLabel(c)!.long}
                  >
                    {distanceLabel(c)!.short}
                  </span>
                ) : null}
              </div>

              <div className="mt-0.5 font-mono text-[13px] text-ink/55">
                {[
                  meta["category"] as string,
                  meta["priceLevel"] as string,
                  meta["googleRating"] ? `${meta["googleRating"]}★` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>

              {c.impact ? (
                <div className="mt-2 flex items-center gap-2">
                  <span
                    className="font-mono text-[13px] uppercase tracking-widest"
                    style={{ color: cert!.color }}
                  >
                    {cert!.label}
                  </span>
                  <span className="font-mono text-[13px] tabular font-bold text-ink">
                    {c.impact.certainty === "unproven"
                      ? "not sized"
                      : `${Math.round(c.impact.customers)} customers · ${money(c.impact.marginUsd)}`}
                  </span>
                </div>
              ) : (
                <div className="mt-2 font-mono text-[12.5px] leading-snug text-ink/45">
                  {c.unidentifiableReason
                    ? "Already inside your baseline - it predates this data, so nothing here separates it."
                    : "Present, but not separately measurable in this window."}
                </div>
              )}
            </button>
          );
        })}

        {discarded.length > 0 ? (
          <div className="px-4 py-3">
            <div className="label mb-1.5 text-ink/40">
              Considered, then discarded
            </div>
            {discarded.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => onFocus(d)}
                className="mt-1 block w-full text-left font-mono text-[13px] leading-snug text-ink/50 hover:text-ink"
              >
                <span className="underline decoration-dotted">{d.label}</span>
                {distanceLabel(d) ? ` - ${distanceLabel(d)!.long} out` : ""}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

// --- Popup bodies ----------------------------------------------------------

function impactRows(pin: MapPin): string {
  if (!pin.impact) {
    return `<div style="margin-top:8px;padding:8px;background:#F4F5F0;border-radius:6px;font-size:11px;line-height:1.45;color:#57534E;">
      <b>No figure claimed.</b> ${
        pin.unidentifiableReason
          ? esc(pin.unidentifiableReason)
          : "The engine could not size this driver separately in this window. It is on the map because it is inside your drive area, not because it was measured."
      }
    </div>`;
  }
  const c = CERTAINTY_COPY[pin.impact.certainty];
  if (pin.impact.certainty === "unproven") {
    return `<div style="margin-top:8px;padding:8px;background:#F4F5F0;border-radius:6px;font-size:11px;line-height:1.45;color:#57534E;">
      <b style="color:${c.color};">Unproven.</b> ${esc(pin.impact.certaintyReason)}
      No customer or margin figure is claimed.
    </div>`;
  }
  const cu = Math.round(pin.impact.customers);
  const lo = Math.round(Math.min(pin.impact.customersLow, pin.impact.customersHigh));
  const hi = Math.round(Math.max(pin.impact.customersLow, pin.impact.customersHigh));
  return `
    <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      <div style="background:#FBF3F2;border-radius:6px;padding:8px;text-align:center;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#991B1B;font-weight:600;">Customers</div>
        <div style="font-size:16px;font-weight:800;color:${COLORS.threat};margin-top:2px;">${cu}</div>
        <div style="font-size:9.5px;color:#78716C;margin-top:1px;">range ${lo} to ${hi}</div>
      </div>
      <div style="background:#FBF3F2;border-radius:6px;padding:8px;text-align:center;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#991B1B;font-weight:600;">Margin</div>
        <div style="font-size:16px;font-weight:800;color:${COLORS.threat};margin-top:2px;">${money(pin.impact.marginUsd)}</div>
        <div style="font-size:9.5px;color:#78716C;margin-top:1px;">over ${pin.impact.activeDays}d</div>
      </div>
    </div>
    <div style="margin-top:6px;font-size:10.5px;line-height:1.4;color:#57534E;">
      <b style="color:${c.color};">${c.label}.</b> ${esc(pin.impact.certaintyReason)}
    </div>`;
}

function competitorPopup(
  pin: MapPin,
  m: Record<string, unknown>,
  minutes: number,
): string {
  const name = (m["businessName"] as string) || pin.label;
  const category = (m["category"] as string) || "Business";
  const price = (m["priceLevel"] as string) || "";
  const dist = distanceLabel(pin)?.long ?? "";
  const rating = m["googleRating"] ? `${m["googleRating"]} / 5.0` : "n/a";
  const note = (m["note"] as string) || "";

  return `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;min-width:236px;padding:2px;">
      <div style="display:flex;align-items:center;gap:8px;padding-bottom:8px;border-bottom:2px solid ${COLORS.ink};">
        <div style="width:10px;height:10px;background:${COLORS.threat};border-radius:50%;flex-shrink:0;"></div>
        <div>
          <div style="font-weight:800;font-size:15px;color:${COLORS.ink};line-height:1.2;">${boldTerms(esc(name))}</div>
          <div style="font-size:11px;color:#666;margin-top:1px;">${esc(category)}${price ? ` · ${esc(price)}` : ""}${dist ? ` · ${esc(dist)}` : ""}</div>
        </div>
      </div>
      ${impactRows(pin)}
      <div style="margin-top:8px;display:flex;justify-content:space-between;font-size:11px;padding:6px 0;border-top:1px solid #E5E5E5;">
        <span style="color:#666;text-transform:uppercase;letter-spacing:.05em;">Rating</span>
        <span style="font-family:ui-monospace,monospace;font-weight:700;color:${COLORS.ink};">${esc(rating)}</span>
      </div>
      ${
        pin.driveTime?.method === "mireye_distance"
          ? `<div style="display:flex;justify-content:space-between;font-size:11px;padding:6px 0;border-top:1px solid #E5E5E5;">
        <span style="color:#666;text-transform:uppercase;letter-spacing:.05em;">Drive time</span>
        <span style="font-family:ui-monospace,monospace;font-weight:700;color:${COLORS.ink};">${esc(distanceLabel(pin)?.long ?? "")}</span>
      </div>`
          : ""
      }
      <div style="display:flex;justify-content:space-between;font-size:11px;padding:6px 0;border-top:1px solid #E5E5E5;">
        <span style="color:#666;text-transform:uppercase;letter-spacing:.05em;">${minutes}-min shed</span>
        <span style="font-family:ui-monospace,monospace;font-weight:700;color:${pin.insidePolygon ? COLORS.threat : "#78716C"};">${pin.insidePolygon ? "INSIDE" : "OUTSIDE"}</span>
      </div>
      ${note ? `<div style="margin-top:6px;font-size:10.5px;line-height:1.4;color:#78716C;">${esc(note)}</div>` : ""}
    </div>`;
}

function closurePopup(pin: MapPin, m: Record<string, unknown>): string {
  const work = (m["work"] as string) || "";
  const agency = (m["agency"] as string) || "";
  const reopen = (m["scheduledReopen"] as string) || "";
  const lostPct = m["polygonAreaLostPct"] ? `${m["polygonAreaLostPct"]}%` : "";

  return `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;min-width:210px;padding:2px;">
      <div style="font-weight:800;font-size:14px;color:${COLORS.ink};padding-bottom:6px;border-bottom:2px solid ${COLORS.ultra};">
        ${boldTerms(esc(pin.label))}
      </div>
      ${work ? `<div style="margin-top:6px;font-size:11px;color:#666;">${esc(work)}</div>` : ""}
      ${agency ? `<div style="font-size:11px;color:#666;margin-top:2px;">${esc(agency)}</div>` : ""}
      ${impactRows(pin)}
      ${
        lostPct
          ? `<div style="margin-top:8px;display:flex;justify-content:space-between;font-size:11px;padding:4px 0;border-top:1px solid #E5E5E5;">
        <span style="color:#666;text-transform:uppercase;letter-spacing:.05em;">Trade area lost</span>
        <span style="font-family:ui-monospace,monospace;font-weight:700;color:${COLORS.ultra};">${esc(lostPct)}</span>
      </div>`
          : ""
      }
      ${
        reopen
          ? `<div style="display:flex;justify-content:space-between;font-size:11px;padding:4px 0;">
        <span style="color:#666;text-transform:uppercase;letter-spacing:.05em;">Reopens</span>
        <span style="font-family:ui-monospace,monospace;font-weight:700;color:#166534;">${esc(reopen)}</span>
      </div>`
          : ""
      }
    </div>`;
}

function genericPopup(pin: MapPin): string {
  return `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;min-width:200px;padding:2px;">
      <div style="font-weight:800;font-size:14px;color:${COLORS.ink};padding-bottom:6px;border-bottom:2px solid ${COLORS.survey};">
        ${boldTerms(esc(pin.label))}
      </div>
      ${impactRows(pin)}
      ${
        pin.membershipReason
          ? `<div style="margin-top:8px;font-size:10.5px;line-height:1.4;color:#78716C;border-top:1px solid #E5E5E5;padding-top:6px;">${esc(pin.membershipReason)}</div>`
          : ""
      }
    </div>`;
}
