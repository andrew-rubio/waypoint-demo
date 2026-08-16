import type { GuidePassage } from '../../../shared/types/destination-advice.js';

/**
 * FRD-003 (INC-8) travel-guide knowledge base — the offline, deterministic
 * counterpart of the Azure AI Search index built from the DK Eyewitness guide
 * "Where To Go When — Unforgettable Trips For Every Month" (src/assets). In
 * production the `travel-guide.searchByMonth` MCP tool runs a hybrid vector
 * query over the vectorised PDF; here a curated month→destinations dataset drawn
 * from that same guide backs the identical shape so tests/demo run without Azure.
 * Rationales paraphrase the guide's "Why Go" notes for each month.
 */

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export type Month = (typeof MONTHS)[number];

/** Month → grounded picks (name/rationale/tags) from the travel guide. */
const GUIDE: Record<Month, Array<Omit<GuidePassage, 'month'>>> = {
  January: [
    { name: 'Tromsø, Norway', rationale: 'January offers one of the best chances to see the Northern Lights over the Arctic city.', tags: ['winter', 'nature', 'northern-lights', 'cold'] },
    { name: 'The Maldives, Indian Ocean', rationale: 'Clear blue skies and calm, sun-kissed waters make January peak beach season.', tags: ['beach', 'warm', 'relaxed', 'island'] },
    { name: 'Jackson Hole, USA', rationale: 'Steep, deep powder makes January the perfect time to ski and snowboard the Tetons.', tags: ['skiing', 'winter', 'mountains', 'cold'] },
    { name: 'Bangkok, Thailand', rationale: 'January is relatively dry and cool, with Western and Chinese New Year celebrations.', tags: ['city', 'food', 'culture', 'warm'] },
    { name: 'Kilimanjaro, Tanzania', rationale: 'January avoids the long rains, giving clearer conditions for the ascent.', tags: ['hiking', 'adventure', 'nature', 'mountains'] },
    { name: 'Havana, Cuba', rationale: 'Warm, dry January days are ideal for the colourful streets and live music.', tags: ['warm', 'culture', 'city', 'music'] },
  ],
  February: [
    { name: 'Agra, India', rationale: 'Cool, clear February skies frame the Taj Mahal at its most photogenic.', tags: ['culture', 'history', 'warm', 'romance'] },
    { name: 'Zermatt, Switzerland', rationale: 'February brings prime alpine snow beneath the Matterhorn for skiers.', tags: ['skiing', 'winter', 'mountains', 'cold'] },
    { name: 'Angkor Wat, Cambodia', rationale: 'February’s dry, mild weather is ideal for exploring the vast temple complex.', tags: ['culture', 'history', 'warm', 'adventure'] },
    { name: 'Ottawa, Canada', rationale: 'Skate the frozen Rideau Canal during February’s Winterlude festival.', tags: ['winter', 'festival', 'city', 'cold'] },
    { name: 'North Island, New Zealand', rationale: 'February is warm and settled — perfect for beaches, wineries and hikes.', tags: ['warm', 'beach', 'nature', 'hiking'] },
    { name: 'Venice, Italy', rationale: 'February’s Carnevale fills the canals with masks and costume.', tags: ['culture', 'festival', 'city', 'romance'] },
  ],
  March: [
    { name: 'Valencia, Spain', rationale: 'March’s Las Fallas festival lights up the city with fire and fireworks.', tags: ['festival', 'city', 'warm', 'food'] },
    { name: 'San Sebastián, Spain', rationale: 'Early-spring March is quiet and mild, with celebrated pintxos bars.', tags: ['food', 'beach', 'city', 'warm'] },
    { name: 'Marrakech, Morocco', rationale: 'March brings comfortable warmth to the souks and Atlas foothills.', tags: ['warm', 'culture', 'city', 'adventure'] },
    { name: 'Ningaloo Reef, Australia', rationale: 'Swim with whale sharks off Ningaloo as the March season begins.', tags: ['beach', 'wildlife', 'warm', 'adventure'] },
    { name: 'The Himalayas, Nepal', rationale: 'Clear March skies and rhododendron blooms make for superb trekking.', tags: ['hiking', 'mountains', 'nature', 'adventure'] },
    { name: 'Chicago, USA', rationale: 'The river turns green for a famously spirited March St Patrick’s Day.', tags: ['city', 'festival', 'culture', 'food'] },
  ],
  April: [
    { name: 'Kyoto, Japan', rationale: 'April’s cherry blossom transforms the temples and gardens.', tags: ['culture', 'nature', 'romance', 'city'] },
    { name: 'Petra, Jordan', rationale: 'Warm, dry April days are ideal for walking the rose-red rock city.', tags: ['history', 'culture', 'warm', 'adventure'] },
    { name: 'The Bollenstreek, Netherlands', rationale: 'April is peak tulip season across the Dutch bulb fields.', tags: ['nature', 'relaxed', 'family', 'spring'] },
    { name: 'Samarkand, Uzbekistan', rationale: 'Mild April light sets off the turquoise domes of the Silk Road.', tags: ['culture', 'history', 'warm', 'adventure'] },
    { name: 'The Galápagos Islands, Ecuador', rationale: 'April’s warm, calm seas bring superb wildlife encounters.', tags: ['wildlife', 'nature', 'beach', 'adventure'] },
    { name: 'Istanbul, Turkey', rationale: 'April’s tulips bloom as the city bridges Europe and Asia.', tags: ['culture', 'history', 'city', 'food'] },
  ],
  May: [
    { name: 'Crete, Greece', rationale: 'May’s warm, uncrowded days are perfect for beaches and gorge walks.', tags: ['beach', 'hiking', 'warm', 'island'] },
    { name: 'Prague, Czech Republic', rationale: 'Spring blossom and mild May weather flatter the old-town spires.', tags: ['city', 'culture', 'history', 'romance'] },
    { name: 'The Lake District, England', rationale: 'May greens the fells for classic walks around the lakes.', tags: ['hiking', 'nature', 'relaxed', 'family'] },
    { name: 'Bali, Indonesia', rationale: 'May opens the dry season with warm seas and green rice terraces.', tags: ['beach', 'warm', 'relaxed', 'culture'] },
    { name: 'Victoria Falls, Zambia', rationale: 'May follows the rains, when the falls thunder at full flow.', tags: ['nature', 'adventure', 'wildlife', 'warm'] },
    { name: 'The West Coast, Scotland', rationale: 'Long, bright May days light up lochs, isles and coastal drives.', tags: ['nature', 'hiking', 'relaxed', 'scenic'] },
  ],
  June: [
    { name: 'Barcelona, Spain', rationale: 'June brings Barcelona’s best weather and a calendar full of festivals.', tags: ['city', 'beach', 'culture', 'warm', 'food'] },
    { name: 'Rome, Italy', rationale: 'June starts the Estate Romana, with events across warm summer evenings.', tags: ['city', 'culture', 'history', 'warm', 'food'] },
    { name: 'The Dalmatian Coast, Croatia', rationale: 'Calm, warm June seas make the Adriatic coast ideal for island-hopping.', tags: ['beach', 'island', 'warm', 'relaxed'] },
    { name: 'Machu Picchu, Peru', rationale: 'Clear June skies and dry trails make the Salkantay trek magical.', tags: ['hiking', 'history', 'adventure', 'mountains'] },
    { name: 'Reykjavík, Iceland', rationale: 'Around-the-clock June daylight opens up waterfalls, hikes and hot springs.', tags: ['nature', 'adventure', 'hiking', 'scenic'] },
    { name: 'Uluru, Australia', rationale: 'June’s forgiving temperatures are the best time to walk the red centre.', tags: ['nature', 'culture', 'adventure', 'warm'] },
    { name: 'Kruger National Park, South Africa', rationale: 'Cooler, drier June is prime time for a Big Five safari.', tags: ['wildlife', 'nature', 'adventure', 'warm'] },
  ],
  July: [
    { name: 'Corsica, France', rationale: 'July is a summer playground of turquoise coves and mountain trails.', tags: ['beach', 'hiking', 'warm', 'island'] },
    { name: 'Provence, France', rationale: 'July peaks the lavender fields across the fragrant countryside.', tags: ['nature', 'relaxed', 'food', 'romance'] },
    { name: 'Svalbard, Norway', rationale: 'July’s 24-hour Arctic sun reveals glaciers and polar wildlife.', tags: ['wildlife', 'nature', 'adventure', 'cold'] },
    { name: 'Salzburg, Austria', rationale: 'The famous July music festival fills the baroque city with concerts.', tags: ['culture', 'festival', 'city', 'music'] },
    { name: 'Pembrokeshire, Wales', rationale: 'July’s long days suit the coast path, beaches and sea kayaking.', tags: ['beach', 'hiking', 'nature', 'family'] },
    { name: 'Copenhagen, Denmark', rationale: 'July draws locals to sunny canals, parks and harbour swims.', tags: ['city', 'relaxed', 'food', 'family'] },
  ],
  August: [
    { name: 'Lucerne, Switzerland', rationale: 'August sun lights the lake and the peaks for cable-car hikes.', tags: ['mountains', 'nature', 'hiking', 'scenic'] },
    { name: 'The Black Forest, Germany', rationale: 'August is warm and green for forest trails and spa towns.', tags: ['nature', 'hiking', 'relaxed', 'family'] },
    { name: 'Yellowstone National Park, USA', rationale: 'August’s warm days open trails past geysers and wildlife.', tags: ['wildlife', 'nature', 'hiking', 'adventure'] },
    { name: 'Lake Bled, Slovenia', rationale: 'August blends alpine lakes, caves and the Adriatic coast.', tags: ['nature', 'hiking', 'beach', 'adventure'] },
    { name: 'Kandy, Sri Lanka', rationale: 'August is the Kandy Esala Perahera, a spectacular procession of elephants and dancers.', tags: ['culture', 'festival', 'warm', 'wildlife'] },
    { name: 'Edinburgh, Scotland', rationale: 'August is Festival season — the Fringe takes over the whole city.', tags: ['festival', 'culture', 'city', 'music'] },
  ],
  September: [
    { name: 'Munich, Germany', rationale: 'Late September opens Oktoberfest with beer halls and brass bands.', tags: ['festival', 'city', 'food', 'culture'] },
    { name: 'The Lycian Coast, Turkey', rationale: 'September’s warm, calm sea is perfect for gulet cruising and ruins.', tags: ['beach', 'history', 'warm', 'relaxed'] },
    { name: 'Galway, Ireland', rationale: 'September’s mild days suit the wild Atlantic coast and lively pubs.', tags: ['culture', 'music', 'nature', 'relaxed'] },
    { name: 'The Namib-Naukluft Park, Namibia', rationale: 'Cool, dry September light sets the red dunes ablaze.', tags: ['nature', 'adventure', 'wildlife', 'scenic'] },
    { name: 'Vermont, USA', rationale: 'September begins New England’s blazing fall foliage.', tags: ['nature', 'relaxed', 'scenic', 'family'] },
    { name: 'Beijing, China', rationale: 'September’s clear, mild skies are ideal for the Great Wall.', tags: ['culture', 'history', 'city', 'warm'] },
  ],
  October: [
    { name: 'Tuscany, Italy', rationale: 'October is the grape and olive harvest across golden hills.', tags: ['food', 'nature', 'relaxed', 'romance'] },
    { name: 'Kyoto, Japan', rationale: 'October’s crisp air begins the famous autumn maple colours.', tags: ['culture', 'nature', 'scenic', 'romance'] },
    { name: 'Budapest, Hungary', rationale: 'October’s cool days are perfect for thermal baths and ruin bars.', tags: ['city', 'culture', 'relaxed', 'food'] },
    { name: 'The Loire Valley, France', rationale: 'October harvest and châteaux make for a mellow river tour.', tags: ['food', 'history', 'relaxed', 'romance'] },
    { name: 'Albuquerque, USA', rationale: 'October fills the sky with the International Balloon Fiesta.', tags: ['festival', 'family', 'scenic', 'adventure'] },
    { name: 'Oaxaca, Mexico', rationale: 'Late October builds to the vivid Día de los Muertos.', tags: ['festival', 'culture', 'food', 'warm'] },
  ],
  November: [
    { name: 'Hoi An, Vietnam', rationale: 'November’s dry, mild weather is ideal along Vietnam’s lantern-lit central coast.', tags: ['culture', 'food', 'warm', 'adventure'] },
    { name: 'Tokyo, Japan', rationale: 'November’s clear skies bring golden ginkgo and maple colour.', tags: ['city', 'culture', 'food', 'scenic'] },
    { name: 'Burgundy, France', rationale: 'November is the season of hearty food and celebrated wine.', tags: ['food', 'relaxed', 'romance', 'culture'] },
    { name: 'Seoul, South Korea', rationale: 'Crisp November days suit palaces, markets and mountain temples.', tags: ['city', 'culture', 'food', 'history'] },
    { name: 'Tasmania, Australia', rationale: 'November opens the southern summer for wild coast and wilderness.', tags: ['nature', 'hiking', 'wildlife', 'adventure'] },
    { name: 'The Bahamas, Caribbean', rationale: 'November’s calm, warm seas start the dry beach season.', tags: ['beach', 'warm', 'relaxed', 'island'] },
  ],
  December: [
    { name: 'Vienna, Austria', rationale: 'December’s Christmas markets and waltz balls light up the city.', tags: ['festival', 'city', 'culture', 'romance'] },
    { name: 'Tortola, British Virgin Islands', rationale: 'Reliably sunny, balmy December makes for perfect Caribbean sailing.', tags: ['beach', 'warm', 'relaxed', 'island'] },
    { name: 'Kerala, India', rationale: 'December is dry and green — ideal for backwaters and beaches.', tags: ['nature', 'relaxed', 'warm', 'beach'] },
    { name: 'Lapland, Finland', rationale: 'No one does Christmas like the Finns — snow, huskies and the aurora.', tags: ['winter', 'family', 'northern-lights', 'cold'] },
    { name: 'San Pedro de Atacama, Chile', rationale: 'December’s warm, clear desert nights are unbeatable for stargazing.', tags: ['nature', 'adventure', 'scenic', 'warm'] },
    { name: 'Sydney, Australia', rationale: 'December is high summer, with harbour beaches and huge New Year fireworks.', tags: ['beach', 'city', 'warm', 'festival'] },
  ],
};

const MONTH_LOOKUP = new Map(MONTHS.map((m) => [m.toLowerCase(), m] as const));

/** Extract a target month from a natural-language request, e.g. "in June" → "June". */
export function extractMonth(message: string): Month | undefined {
  const lower = message.toLowerCase();
  for (const month of MONTHS) {
    if (new RegExp(`\\b${month.toLowerCase()}\\b`).test(lower)) return month;
  }
  return undefined;
}

/**
 * Hybrid month query over the guide (offline). Returns the guide's picks for the
 * month with the `month` field set; an unknown month yields no passages, which
 * drives the preference-based fallback.
 */
export function searchGuideByMonth(month: string): GuidePassage[] {
  const canonical = MONTH_LOOKUP.get(month.trim().toLowerCase());
  if (!canonical) return [];
  return GUIDE[canonical].map((entry) => ({ ...entry, month: canonical }));
}

/** Redacted summary for the `travel-guide.searchByMonth` mcp audit entry. */
export function guideAuditSummary(month: string, passages: GuidePassage[], source: 'ai-search' | 'offline' = 'offline'): Record<string, unknown> {
  return {
    index: 'travel-guide',
    month,
    source,
    passages: passages.length,
    destinations: passages.map((p) => p.name),
  };
}
