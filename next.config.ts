import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Ship the data the pages read at request time.
   *
   * Next traces the imports of each route to decide what to bundle into its
   * serverless function, but it cannot see files opened by a path built at
   * runtime - `fs.readFileSync(path.join(process.cwd(), "data", ...))`. Without
   * this, the deployed function has the code but none of the committed store
   * seed, recorded Mireye fixtures, or scenario JSON, and every page 404s its
   * own data. These globs force them in.
   */
  outputFileTracingIncludes: {
    "/site/[slug]": [
      "./data/seed/**",
      "./data/fixtures/mireye/**",
      "./data/scenarios/**",
    ],
    "/": ["./data/seed/**", "./data/scenarios/**"],
    "/ops": ["./data/seed/**"],
    "/api/**": [
      "./data/seed/**",
      "./data/fixtures/mireye/**",
      "./data/scenarios/**",
    ],
  },
};

export default nextConfig;
