"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export function DashboardTabs({
  overview,
  actions,
  advertising,
  threats,
  math,
}: {
  overview: React.ReactNode;
  actions: React.ReactNode;
  advertising: React.ReactNode;
  threats: React.ReactNode;
  math: React.ReactNode;
}) {
  const [activeTab, setActiveTab] = useState("overview");
  // Lazy-mount: the map tab is NOT rendered until it is first visited.
  // Once mounted it stays mounted so MapLibre keeps its WebGL context.
  const [advertisingMounted, setAdvertisingMounted] = useState(false);

  const tabs = [
    { id: "overview", label: "The Verdict" },
    { id: "actions", label: "Action Center" },
    { id: "advertising", label: "Advertising & Trade Area" },
    { id: "threats", label: "Street Events & Threats" },
    { id: "math", label: "The Math" },
  ];

  return (
    <div className="flex flex-col lg:flex-row gap-10 mt-6 mx-auto w-full max-w-[1440px] px-7 py-7">
      <aside className="w-full lg:w-72 shrink-0">
        <div className="sticky top-12">
          <div className="label mb-4 px-4 text-ink/50">Analysis Views</div>
          <nav className="flex flex-col gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                  // First visit to the map tab: mount it
                  if (tab.id === "advertising") {
                    setAdvertisingMounted(true);
                  }
                  // Give the DOM one frame to show the container, then
                  // tell MapLibre the world changed.
                  setTimeout(() => window.dispatchEvent(new Event("resize")), 100);
                }}
                className={`text-left px-4 py-3 font-mono text-[13px] uppercase tracking-wide border-l-[3px] transition-all duration-200 ${
                  activeTab === tab.id
                    ? "border-ink bg-limestone text-ink font-bold shadow-sm"
                    : "border-transparent text-ink/60 hover:text-ink hover:bg-limestone/50 hover:border-ink/20"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </aside>

      <main className="flex-1 min-w-0 pb-20">
        <div className={activeTab === "overview" ? "block animate-fade-in-up" : "hidden"}>
          {overview}
        </div>
        <div className={activeTab === "actions" ? "block animate-fade-in-up" : "hidden"}>
          {actions}
        </div>
        {/* The map tab is only mounted once the user first visits it.
            After that it stays in the DOM with display:none/block so
            MapLibre keeps its WebGL context and canvas size. */}
        {advertisingMounted && (
          <div className={activeTab === "advertising" ? "block animate-fade-in-up" : "hidden"}>
            {advertising}
          </div>
        )}
        <div className={activeTab === "threats" ? "block animate-fade-in-up" : "hidden"}>
          {threats}
        </div>
        <div className={activeTab === "math" ? "block animate-fade-in-up" : "hidden"}>
          {math}
        </div>
      </main>
    </div>
  );
}

export function ScenarioSelector({
  scenarios,
  currentScenarioKey,
  slug,
}: {
  scenarios: { key: string; name: string; description: string }[];
  currentScenarioKey: string;
  slug: string;
}) {
  const router = useRouter();

  // Create a friendlier name mapping for the scenarios
  const getFriendlyName = (name: string) => {
    const map: Record<string, string> = {
      "Road closure dip": "Road Closure Impact",
      "Clean baseline": "Normal Week (Baseline)",
      "Competitor entry": "New Competitor Simulation",
      "Weather event": "Extreme Weather Impact",
    };
    return map[name] || name;
  };

  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-[12px] uppercase tracking-widest text-ink/60">
        Simulating Scenario:
      </span>
      <select
        value={currentScenarioKey}
        onChange={(e) => {
          if (e.target.value === "ops") {
            router.push("/ops");
          } else {
            router.push(`/site/${slug}?scenario=${e.target.value}`);
          }
        }}
        className="border-2 border-ink bg-paper px-3 py-2 font-display text-[15px] font-bold uppercase tracking-wide text-ink cursor-pointer hover:bg-limestone transition-colors outline-none"
      >
        {scenarios.map((s) => (
          <option key={s.key} value={s.key} title={s.description}>
            {getFriendlyName(s.name)}
          </option>
        ))}
        <option value="ops">View Ops Settings</option>
      </select>
    </div>
  );
}
