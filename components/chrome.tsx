import type { ReactNode } from "react";

/**
 * The survey-sheet chrome. Every page in Groundwork is a numbered sheet with a
 * header rail, so the app reads as a set of drawings rather than a dashboard.
 */

export function Sheet({
  children,
  className = "",
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div id={id} className={`mx-auto w-full max-w-[1080px] px-7 ${className}`}>
      {children}
    </div>
  );
}

/** [01] TRADE AREA ─────────────────── SHEET 1 OF 6 */
export function Plate({
  no,
  name,
  of,
}: {
  no: string;
  name: string;
  of?: string;
}) {
  return (
    <div className="plate pt-14 mb-8">
      <span className="plate-no">{no}</span>
      <span className="label">{name}</span>
      <span className="plate-rule" />
      {of ? (
        <span className="font-mono text-[12px] text-stone">{of}</span>
      ) : null}
    </div>
  );
}

export function Card({
  children,
  flat = false,
  className = "",
}: {
  children: ReactNode;
  flat?: boolean;
  className?: string;
}) {
  return (
    <div className={`${flat ? "card-flat" : "card"} p-5 ${className}`}>
      {children}
    </div>
  );
}

/** The mono caps label that sits above a value. */
export function Label({ children }: { children: ReactNode }) {
  return <div className="label mb-1.5">{children}</div>;
}

/**
 * A metadata rail: a row of labelled facts under a heading, divided by
 * hairlines. Used on the cover and above every map.
 */
export function MetaRow({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <div className="flex flex-wrap border-t-[1.5px] border-ink">
      {items.map((item, i) => (
        <div
          key={item.label}
          className={`flex-1 basis-[170px] px-4 py-3.5 font-mono text-[12px] leading-relaxed ${
            i < items.length - 1 ? "border-r border-rule" : ""
          }`}
        >
          <span className="label block">{item.label}</span>
          <span className="tabular">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

/** A small bordered tag, survey green. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block border border-survey px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em] text-survey">
      {children}
    </span>
  );
}

export function Footer() {
  return (
    <Sheet>
      <div className="mt-16 flex flex-wrap justify-between gap-5 border-t-[1.5px] border-ink py-5 pb-14 font-mono text-[11.5px] text-survey">
        <span>Groundwork · concept demo</span>
        <span>Ground layer: Mireye Earth (live) · ledger &amp; world: fixtures</span>
      </div>
    </Sheet>
  );
}
