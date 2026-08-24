/**
 * The seeded demo addresses.
 *
 * All three are real Austin food-and-beverage businesses at rooftop-geocodable
 * addresses, chosen so the drive-polygon-versus-radius contrast is genuine
 * rather than cosmetic: Lady Bird Lake has a countable number of crossings and
 * I-35 is a real barrier, so an 8-minute drive shed and a 5-mile circle are
 * visibly different shapes here.
 *
 * Edit this file to demo a different address — nothing else references these
 * slugs directly except the seed script.
 */

export interface DemoSite {
  slug: string;
  label: string;
  /** Full address including city, state and ZIP. Mireye refuses bare street
   *  lines ("1412 market street" matches a town in West Virginia), so the
   *  locality is never omitted here. */
  address: string;
  category: string;
  whyThisOne: string;
  /**
   * Approximate rooftop coordinate, used ONLY when no MIREYE_API_KEY is
   * present, and always flagged `approximate` downstream so nothing claims
   * parcel-grade precision it does not have. Mireye /v1/lookup replaces this
   * with a real parcel match the moment a key exists.
   */
  fallbackAt: { lat: number; lng: number };
}

export const DEMO_SITES: DemoSite[] = [
  {
    slug: "jos-coffee",
    label: "Jo's Coffee",
    address: "1300 S Congress Ave, Austin, TX 78704",
    category: "Coffee · South Congress",
    whyThisOne:
      "Sits south of Lady Bird Lake. Its drive shed is shaped by which bridges are open — the clearest case against a radius.",
    fallbackAt: { lat: 30.2515, lng: -97.7494 },
  },
  {
    slug: "radio-coffee",
    label: "Radio Coffee & Beer",
    address: "4204 Menchaca Rd, Austin, TX 78704",
    category: "Coffee & bar · Menchaca",
    whyThisOne:
      "Arterial-dependent and south of the river. A single resurfacing permit on Menchaca reshapes the whole trade area.",
    fallbackAt: { lat: 30.2265, lng: -97.7935 },
  },
  {
    slug: "franklin-barbecue",
    label: "Franklin Barbecue",
    address: "900 E 11th St, Austin, TX 78702",
    category: "Restaurant · East Austin",
    whyThisOne:
      "Hard against I-35. The freeway splits its circle in half without splitting its drive time, which is the inverse case.",
    fallbackAt: { lat: 30.2701, lng: -97.7313 },
  },
];

export function demoSiteBySlug(slug: string): DemoSite | undefined {
  return DEMO_SITES.find((s) => s.slug === slug);
}
