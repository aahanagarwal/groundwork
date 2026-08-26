/**
 * The seeded demo addresses.
 *
 * All of them are real Austin food-and-beverage businesses at rooftop-geocodable
 * addresses, chosen so the drive-polygon-versus-radius contrast is genuine
 * rather than cosmetic: Lady Bird Lake has a countable number of crossings and
 * I-35 is a real barrier, so an 8-minute drive shed and a 5-mile circle are
 * visibly different shapes here.
 *
 * Each entry earns its place by making a DIFFERENT argument - water, freeway,
 * parkland, one-way grid, arterial, congestion - because thirteen addresses
 * that all say the same thing is one address thirteen times.
 *
 * Every coordinate below was returned by Mireye /v1/lookup at
 * accuracy_type=geocode_rooftop, not typed in by hand. Adding an address is not
 * free: a first load resolves the parcel (300 credits) and draws the drive shed
 * (~960), so roughly 1,276 credits each, once, and cached forever after.
 *
 * Edit this file to demo a different address - nothing else references these
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
      "Sits south of Lady Bird Lake. Its drive shed is shaped by which bridges are open - the clearest case against a radius.",
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
  {
    slug: "mozarts-coffee",
    label: "Mozart's Coffee Roasting",
    address: "3825 Lake Austin Blvd, Austin, TX 78703",
    category: "Coffee · Lake Austin",
    whyThisOne:
      "The strongest case in the set. It sits on a strip of land with water on one side and a ridge on the other, so most of a 5-mile circle drawn here is lake, hillside, or reachable only by doubling back to a bridge.",
    fallbackAt: { lat: 30.295237, lng: -97.784238 },
  },
  {
    slug: "the-oasis",
    label: "The Oasis on Lake Travis",
    address: "6550 Comanche Trail, Austin, TX 78732",
    category: "Restaurant · Lake Travis",
    whyThisOne:
      "Far out on the lake and served by winding two-lane approaches. The circle is enormous and the drive shed is a thin sliver along the road in - the extreme version of the same argument.",
    fallbackAt: { lat: 30.404982, lng: -97.873411 },
  },
  {
    slug: "veracruz-all-natural",
    label: "Veracruz All Natural",
    address: "1704 E Cesar Chavez St, Austin, TX 78702",
    category: "Taqueria · East Cesar Chavez",
    whyThisOne:
      "East of I-35 on a dense grid. The freeway is a barrier westward while the grid is fast in every other direction, so the shed is lopsided in a way a radius cannot express.",
    fallbackAt: { lat: 30.257942, lng: -97.726042 },
  },
  {
    slug: "home-slice",
    label: "Home Slice Pizza",
    address: "1415 S Congress Ave, Austin, TX 78704",
    category: "Pizza · South Congress",
    whyThisOne:
      "Two hundred metres from Jo's Coffee. Two businesses this close share a trade area almost exactly, which is the control case: when the geography is the same, any difference in the till is not geography.",
    fallbackAt: { lat: 30.249208, lng: -97.749445 },
  },
  {
    slug: "terry-blacks",
    label: "Terry Black's Barbecue",
    address: "1003 Barton Springs Rd, Austin, TX 78704",
    category: "Barbecue · Barton Springs",
    whyThisOne:
      "Wedged between the lake and Zilker Park. Parkland eats a large share of any circle drawn here without contributing a single customer.",
    fallbackAt: { lat: 30.259866, lng: -97.754972 },
  },
  {
    slug: "easy-tiger",
    label: "Easy Tiger",
    address: "709 E 6th St, Austin, TX 78701",
    category: "Bakery & beer garden · East 6th",
    whyThisOne:
      "Downtown, on a one-way grid. One-way streets make the drive shed asymmetric in a way straight-line distance is blind to - the way out is not the way in.",
    fallbackAt: { lat: 30.265812, lng: -97.735701 },
  },
  {
    slug: "kerbey-lane",
    label: "Kerbey Lane Cafe",
    address: "3704 Kerbey Ln, Austin, TX 78731",
    category: "Cafe · Central West",
    whyThisOne:
      "Inside a residential street network with few through-routes. Dense on the map, slow to cross, so the shed is much smaller than the circle suggests.",
    fallbackAt: { lat: 30.308092, lng: -97.750451 },
  },
  {
    slug: "uchi",
    label: "Uchi",
    address: "801 S Lamar Blvd, Austin, TX 78704",
    category: "Restaurant · South Lamar",
    whyThisOne:
      "On a major arterial. The shed stretches a long way along Lamar and barely at all across it, which is the shape an arterial always produces and a circle never shows.",
    fallbackAt: { lat: 30.257552, lng: -97.75982 },
  },
  {
    slug: "amys-ice-creams",
    label: "Amy's Ice Creams",
    address: "3500 Guadalupe St, Austin, TX 78705",
    category: "Ice cream · North Campus",
    whyThisOne:
      "Beside UT Austin. Term dates move its baseline more than weather does, which makes it the clearest test of whether the engine can tell a calendar from a cause.",
    fallbackAt: { lat: 30.301449, lng: -97.7394 },
  },
  {
    slug: "counter-cafe",
    label: "Counter Cafe",
    address: "626 N Lamar Blvd, Austin, TX 78703",
    category: "Diner · North Lamar",
    whyThisOne:
      "Near the Lamar and 6th interchange, where congestion is the constraint rather than distance. Drive time and straight-line distance diverge most here at rush hour.",
    fallbackAt: { lat: 30.272671, lng: -97.753776 },
  },
];

export function demoSiteBySlug(slug: string): DemoSite | undefined {
  return DEMO_SITES.find((s) => s.slug === slug);
}
