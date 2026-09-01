export default function Loading() {
  return (
    <div className="min-h-screen bg-paper text-ink font-sans">
      {/* Header Skeleton */}
      <header className="border-b-[1.5px] border-ink bg-limestone px-7 py-5">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-5 w-24 bg-ink/10 rounded animate-pulse" />
            <div className="h-6 w-48 bg-ink/20 rounded animate-pulse" />
          </div>
          <div className="h-9 w-44 bg-ink/10 rounded border border-rule animate-pulse" />
        </div>
      </header>

      {/* Main Layout Skeleton */}
      <div className="flex flex-col lg:flex-row gap-10 mt-6 mx-auto w-full max-w-[1440px] px-7 py-7">
        {/* Sidebar Nav Skeleton */}
        <aside className="w-full lg:w-72 shrink-0">
          <div className="sticky top-12 space-y-2">
            <div className="h-3 w-28 bg-ink/10 rounded mb-4" />
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-11 w-full bg-limestone/60 rounded border-l-[3px] border-ink/20 animate-pulse"
              />
            ))}
          </div>
        </aside>

        {/* Main Content Skeleton */}
        <main className="flex-1 min-w-0 pb-20 space-y-8">
          {/* Banner Skeleton */}
          <div className="h-20 w-full bg-limestone/50 border border-rule rounded p-5 flex items-center justify-between animate-pulse">
            <div className="space-y-2">
              <div className="h-4 w-48 bg-ink/20 rounded" />
              <div className="h-3 w-80 bg-ink/10 rounded" />
            </div>
            <div className="h-8 w-24 bg-ink/10 rounded" />
          </div>

          {/* KPI Verdict Strip Skeleton */}
          <div className="border-2 border-ink rounded overflow-hidden bg-paper">
            <div className="h-14 bg-limestone/80 border-b border-ink px-6 flex items-center justify-between">
              <div className="h-5 w-40 bg-ink/20 rounded animate-pulse" />
              <div className="h-4 w-28 bg-ink/10 rounded animate-pulse" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-rule">
              {[1, 2, 3].map((i) => (
                <div key={i} className="p-6 space-y-2">
                  <div className="h-3 w-20 bg-ink/10 rounded" />
                  <div className="h-8 w-28 bg-ink/20 rounded animate-pulse" />
                  <div className="h-3 w-36 bg-ink/10 rounded" />
                </div>
              ))}
            </div>
          </div>

          {/* Cards Skeleton */}
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 w-full bg-limestone/30 border border-rule rounded p-5 flex items-center justify-between animate-pulse"
              >
                <div className="space-y-2">
                  <div className="h-4 w-56 bg-ink/20 rounded" />
                  <div className="h-3 w-96 bg-ink/10 rounded" />
                </div>
                <div className="h-6 w-16 bg-ink/10 rounded" />
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
