import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logStep } from "./lib/fetch-utils.js";
import { boroughOutcodeKey, loadOutcodeBoroughPairs } from "./lib/geo.js";
import type { EventsData, HistoryData, Place, PlacesData } from "../../src/lib/types.js";

const STEP = "seed";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../data/raw");

/**
 * Places, events, and history have no open API anywhere (this is true of the
 * golders-green.co.uk benchmark too — these are editorial categories). Rather
 * than fabricate specifics we can't verify (exact addresses, invented events),
 * this is hand-curated using only well-established, verifiable facts.
 *
 * Richmond upon Thames has fine-grained OUTCODE-level content (16 outcodes,
 * built first as the POC). Every other borough gets BOROUGH-level content
 * instead — one accurate history summary and a handful of defining landmarks
 * per borough, applied to every outcode in it. Doing Richmond's outcode-level
 * depth of fact-checked research for ~300 outcodes across London isn't
 * something that can be done responsibly without real risk of inventing
 * details, so this is deliberately scoped to be verifiable at 33 items.
 */

const OUTCODE_PLACES: Record<string, Place[]> = {
  TW9: [
    { name: "Royal Botanic Gardens, Kew", category: "park", address: "Kew, Richmond upon Thames, TW9", description: "UNESCO World Heritage Site and the world's largest collection of living plants." },
    { name: "The National Archives", category: "community-hub", address: "Kew, Richmond upon Thames, TW9", description: "The UK government's official archive, holding over 1,000 years of records." },
  ],
  TW1: [
    { name: "Twickenham Stadium", category: "leisure-centre", address: "Twickenham, TW1", description: "The home of England Rugby, and the world's second-largest rugby union venue." },
    { name: "Marble Hill Park", category: "park", address: "Twickenham, TW1", description: "Riverside park surrounding Marble Hill House, an English Heritage Palladian villa." },
  ],
  TW10: [
    { name: "Ham House and Garden", category: "community-hub", address: "Ham, Richmond upon Thames, TW10", description: "A National Trust 17th-century house on the banks of the Thames." },
    { name: "Richmond Hill", category: "park", address: "Richmond, TW10", description: "Home to the View from Richmond Hill, the only view in England protected by its own Act of Parliament." },
  ],
  TW11: [
    { name: "Teddington Lock", category: "park", address: "Teddington, TW11", description: "The largest lock complex on the Thames and the river's tidal limit." },
  ],
  TW12: [
    { name: "Bushy Park", category: "park", address: "Hampton, TW12", description: "London's second-largest Royal Park, known for its wild deer herds and Chestnut Avenue." },
  ],
  KT8: [
    { name: "Hampton Court Palace", category: "community-hub", address: "Hampton Court, KT8", description: "Former residence of Henry VIII, now a Historic Royal Palace open to visitors." },
  ],
  SW13: [
    { name: "WWT London Wetland Centre", category: "park", address: "Barnes, SW13", description: "A 42-hectare wetland nature reserve and wildlife charity site on the site of former reservoirs." },
    { name: "Barnes Common", category: "park", address: "Barnes, SW13", description: "Local nature reserve and open green space in the historic village of Barnes." },
  ],
  SW14: [
    { name: "East Sheen Common", category: "park", address: "East Sheen, SW14", description: "Woodland and open common bordering Richmond Park." },
  ],
};

const OUTCODE_HISTORY: Record<string, string> = {
  TW9: "TW9 covers Kew and part of Richmond town, best known worldwide for the Royal Botanic Gardens, Kew — a UNESCO World Heritage Site since 2003 and one of the world's leading botanical research institutions.",
  TW1: "TW1 covers Twickenham, internationally known as the home of England Rugby since Twickenham Stadium opened in 1909. The area also has Georgian riverside heritage around Marble Hill.",
  TW10: "TW10 covers Richmond Hill and Ham. The view from Richmond Hill has been protected by Act of Parliament since 1902, making it the only view in England with statutory legal protection.",
  TW11: "TW11 covers Teddington, whose name is linked to the Thames tidal limit at Teddington Lock, the largest lock complex on the river.",
  TW12: "TW12 covers Hampton, home to Bushy Park — London's second-largest Royal Park after Richmond Park itself.",
  KT8: "KT8 spans part of Hampton Court, seat of Hampton Court Palace, the former Tudor residence of King Henry VIII.",
  SW13: "SW13 covers Barnes, a historic Thames-side village that lies along the Oxford v Cambridge Boat Race course and is home to the WWT London Wetland Centre.",
  SW14: "SW14 covers Mortlake and East Sheen; the Boat Race finishes near Chiswick Bridge at the Mortlake end of the borough.",
};

// One history summary + a few defining landmarks per London borough — the
// fallback for every outcode that doesn't have Richmond's finer per-outcode
// entries above. Only well-established, verifiable facts.
const BOROUGH_HISTORY: Record<string, string> = {
  "Barking and Dagenham": "Formed in 1965 from the former municipal boroughs of Barking and Dagenham. Dagenham's Becontree Estate, built by the London County Council from the 1920s, was for a time the largest public housing estate in the world.",
  Barnet: "London's largest borough by population, formed in 1965 from Finchley, Hendon, Barnet, Friern Barnet, and East Barnet. The Battle of Barnet, a decisive clash in the Wars of the Roses, was fought here in 1471.",
  Bexley: "Formed in 1965 from the former boroughs of Bexley and Erith along with Crayford and Sidcup. Hall Place, a Tudor manor house begun in 1537, and the Georgian Danson House are among its historic buildings.",
  Brent: "Formed in 1965 from the merger of Wembley and Willesden. Home to Wembley Stadium, the national stadium of English football, rebuilt on the site of its 1923 predecessor and reopened in 2007.",
  Bromley: "London's largest borough by area, formed in 1965 largely from the old county of Kent. Down House in Downe village was the family home of Charles Darwin, where he wrote On the Origin of Species.",
  Camden: "Formed in 1965 from Hampstead, Holborn, and St Pancras. Home to the British Museum, the British Library, and Camden Market, one of the UK's most visited attractions.",
  "City of London": "The historic core of London and a separate ceremonial county in its own right, governed by the City of London Corporation and headed by the Lord Mayor of London (distinct from the Mayor of London). St Paul's Cathedral and the Bank of England stand within its \"Square Mile\".",
  Croydon: "Historically part of Surrey until becoming a London borough in 1965. Croydon Airport served as London's principal airport for international flights before Heathrow opened, and the area remains one of London's largest commercial centres outside the centre.",
  Ealing: "Nicknamed the \"Queen of the Suburbs\" in Victorian times. Ealing Studios, founded in 1902, is the oldest continuously working film studio facility in the world.",
  Enfield: "Formed in 1965 from Enfield, Edmonton, and Southgate. Forty Hall, a Jacobean mansion built in 1629, and the former Royal Small Arms Factory (source of the Lee-Enfield rifle name) are notable local landmarks.",
  Greenwich: "Granted Royal Borough status in 2012 to mark the Queen's Diamond Jubilee. Home to the Prime Meridian at the Royal Observatory, from which Greenwich Mean Time takes its name, and to Maritime Greenwich, a UNESCO World Heritage Site.",
  Hackney: "Formed in 1965 from Hackney, Shoreditch, and Stoke Newington. Victoria Park, opened in 1845 as one of the first public parks in the East End, straddles Hackney's border with Tower Hamlets.",
  "Hammersmith and Fulham": "Formed in 1965 from the former boroughs of Hammersmith and Fulham. Stamford Bridge, home of Chelsea Football Club since 1905, is located within the borough despite the club's name referencing its neighbour.",
  Haringey: "Formed in 1965 from Hornsey, Tottenham, and Wood Green. Alexandra Palace hosted the BBC's first regular high-definition television broadcasts in 1936.",
  Harrow: "Home to Harrow School, one of England's oldest and best-known public schools, founded in 1572 on Harrow-on-the-Hill.",
  Havering: "Formed in 1965 from Romford and Hornchurch, formerly part of Essex. Romford Market, established by royal charter in 1247, remains one of the largest outdoor markets in the country.",
  Hillingdon: "One of London's largest boroughs by area, formed in 1965. Most of Heathrow Airport, the UK's busiest, lies within its boundaries.",
  Hounslow: "Formed in 1965 from Heston and Isleworth, Brentford and Chiswick, and Feltham. Home to the western part of Heathrow Airport and to Chiswick House, a celebrated 18th-century Palladian villa.",
  Islington: "One of London's smallest but most densely populated boroughs. Sadler's Wells, a theatre with roots going back to 1683, and Arsenal Football Club's Emirates Stadium are both here.",
  "Kensington and Chelsea": "London's smallest borough by area, a Royal Borough and one of the most affluent in the country. South Kensington's \"Albertopolis\" is home to the Natural History Museum, Science Museum, and Victoria and Albert Museum.",
  "Kingston upon Thames": "A Royal Borough and historic market town where several Anglo-Saxon kings were crowned; the Coronation Stone used in these ceremonies is displayed near the Guildhall.",
  Lambeth: "Home to Lambeth Palace, the official London residence of the Archbishop of Canterbury for over 800 years, and to the South Bank's cultural quarter including the Royal Festival Hall.",
  Lewisham: "Formed in 1965 from Lewisham and Deptford. Deptford was the site of the royal dockyard founded by Henry VIII in 1513, from which many famous naval expeditions set sail.",
  Merton: "Formed in 1965 from Wimbledon, Mitcham, and Morden. Home to the All England Lawn Tennis Club, host of the Wimbledon Championships since 1877.",
  Newham: "Formed in 1965 from East Ham and West Ham. Queen Elizabeth Olympic Park, the main venue for the London 2012 Olympics, lies substantially within the borough.",
  Redbridge: "Formed in 1965 from Ilford, Wanstead, and Woodford, formerly part of Essex. Hainault Forest and Valentines Park are among its larger green spaces.",
  "Richmond upon Thames": "Formed in 1965 under the London Government Act 1963, merging the former municipal boroughs of Richmond, Twickenham, and Barnes with the Hampton and Hampton Wick areas of the old Twickenham Rural District. It is the only London borough with land on both banks of the River Thames, and includes both Richmond Park and Bushy Park, the two largest of London's Royal Parks.",
  Southwark: "Home to Shakespeare's Globe, a reconstruction of the Elizabethan theatre near its original Bankside site, and to Borough Market, trading in some form since at least the 12th century.",
  Sutton: "Formed in 1965 from Sutton and Cheam, Carshalton, and Beddington and Wallington, formerly part of Surrey. One of the greener, more suburban outer London boroughs.",
  "Tower Hamlets": "Named for its historic hamlets bordering the Tower of London. Canary Wharf, one of the UK's two main financial centres, was developed from the 1980s on former Docklands land within the borough.",
  "Waltham Forest": "Formed in 1965 from Chingford, Leyton, and Walthamstow. The William Morris Gallery in Walthamstow occupies the childhood home of the designer and writer William Morris; the borough was London's first Borough of Culture in 2019.",
  Wandsworth: "Home to Battersea Power Station, the iconic decommissioned coal-fired station on the Thames, and to Clapham Junction, one of the busiest railway interchanges in Europe despite its name referencing neighbouring Lambeth.",
  Westminster: "The City of Westminster sits at the heart of UK government and culture, home to the Houses of Parliament, Buckingham Palace, Westminster Abbey, and the West End theatre district.",
};

const BOROUGH_PLACES: Record<string, Place[]> = {
  "Barking and Dagenham": [{ name: "Eastbrookend Country Park", category: "park", address: "Dagenham", description: "A large country park with lakes and nature trails on the site of former gravel pits." }],
  Barnet: [{ name: "RAF Museum London", category: "community-hub", address: "Hendon", description: "The Royal Air Force's national museum, built around historic Hendon Aerodrome." }],
  Bexley: [{ name: "Hall Place and Gardens", category: "community-hub", address: "Bexley", description: "A Tudor manor house with Grade I and II listed formal gardens, open to the public." }],
  Brent: [{ name: "Wembley Stadium", category: "leisure-centre", address: "Wembley", description: "England's national football stadium, with an 90,000 capacity." }],
  Bromley: [{ name: "Crystal Palace Park", category: "park", address: "Bromley/Croydon border", description: "A large Victorian park containing the world-famous Crystal Palace Dinosaurs sculptures." }],
  Camden: [{ name: "Camden Market", category: "community-hub", address: "Camden Town", description: "One of the UK's most visited attractions, a sprawling market for fashion, food, and crafts." }],
  "City of London": [{ name: "St Paul's Cathedral", category: "community-hub", address: "City of London", description: "Sir Christopher Wren's Baroque cathedral, completed in 1710, at the heart of the Square Mile." }],
  Croydon: [{ name: "Lloyd Park", category: "park", address: "Croydon", description: "A large public park in the shadow of Croydon's historic Addington Hills." }],
  Ealing: [{ name: "Walpole Park", category: "park", address: "Ealing", description: "A historic park surrounding Pitzhanger Manor, designed in part by Sir John Soane." }],
  Enfield: [{ name: "Forty Hall", category: "community-hub", address: "Enfield", description: "A Jacobean mansion set in a 275-acre country park, now a museum and gallery." }],
  Greenwich: [{ name: "Royal Observatory Greenwich", category: "community-hub", address: "Greenwich Park", description: "Home of the Prime Meridian and Greenwich Mean Time, within a UNESCO World Heritage Site." }],
  Hackney: [{ name: "Victoria Park", category: "park", address: "Hackney/Tower Hamlets border", description: "One of London's oldest public parks, opened in 1845 for the East End." }],
  "Hammersmith and Fulham": [{ name: "Bishops Park", category: "park", address: "Fulham", description: "A riverside park next to Fulham Palace, the former residence of the Bishops of London." }],
  Haringey: [{ name: "Alexandra Palace", category: "community-hub", address: "Alexandra Park", description: "A Victorian entertainment venue on a hilltop park, site of the BBC's first TV broadcasts in 1936." }],
  Harrow: [{ name: "Harrow School", category: "community-hub", address: "Harrow-on-the-Hill", description: "One of England's oldest public schools, founded in 1572." }],
  Havering: [{ name: "Raphael Park", category: "park", address: "Romford", description: "A Victorian park with a boating lake, adjoining the historic Gidea Park estate." }],
  Hillingdon: [{ name: "Cranford Country Park", category: "park", address: "Hillingdon", description: "Woodland and meadows around the former Cranford House estate." }],
  Hounslow: [{ name: "Chiswick House and Gardens", category: "community-hub", address: "Chiswick", description: "A celebrated 18th-century Palladian villa with historic landscape gardens." }],
  Islington: [{ name: "Sadler's Wells", category: "leisure-centre", address: "Islington", description: "A leading dance theatre with roots going back to a 17th-century well." }],
  "Kensington and Chelsea": [{ name: "Natural History Museum", category: "community-hub", address: "South Kensington", description: "One of the world's great natural history collections, housed in a landmark Victorian building." }],
  "Kingston upon Thames": [{ name: "Kingston Market Place", category: "community-hub", address: "Kingston upon Thames", description: "A historic market place, home to the ancient Coronation Stone of Anglo-Saxon kings." }],
  Lambeth: [{ name: "Lambeth Palace", category: "community-hub", address: "Lambeth", description: "The official London residence of the Archbishop of Canterbury for over 800 years." }],
  Lewisham: [{ name: "Horniman Museum and Gardens", category: "community-hub", address: "Forest Hill", description: "A free museum of anthropology and natural history set in 16 acres of gardens." }],
  Merton: [{ name: "All England Lawn Tennis Club", category: "leisure-centre", address: "Wimbledon", description: "Host of the Wimbledon Championships, the oldest tennis tournament in the world, since 1877." }],
  Newham: [{ name: "Queen Elizabeth Olympic Park", category: "park", address: "Stratford", description: "The main venue for the London 2012 Olympics, now a public park and sports venue." }],
  Redbridge: [{ name: "Valentines Park", category: "park", address: "Ilford", description: "A large Victorian park surrounding the historic Valentines Mansion." }],
  Southwark: [{ name: "Borough Market", category: "community-hub", address: "Southwark", description: "One of London's oldest food markets, trading in some form since the 12th century." }],
  Sutton: [{ name: "Carshalton Park", category: "park", address: "Carshalton", description: "A green space in one of Sutton's oldest villages, known for its ponds and lavender fields nearby." }],
  "Tower Hamlets": [{ name: "Victoria Park", category: "park", address: "Tower Hamlets/Hackney border", description: "One of London's oldest public parks, opened in 1845 for the East End." }],
  "Waltham Forest": [{ name: "William Morris Gallery", category: "community-hub", address: "Walthamstow", description: "A free gallery in the childhood home of designer and writer William Morris." }],
  Wandsworth: [{ name: "Battersea Park", category: "park", address: "Battersea", description: "A large Thames-side park opened in 1858, near the landmark Battersea Power Station." }],
  Westminster: [{ name: "Westminster Abbey", category: "community-hub", address: "Westminster", description: "The historic coronation church of English and British monarchs since 1066." }],
};

// A single verified, borough-agnostic London events resource, used as the
// events link-out for every borough except Richmond upon Thames, which has
// its own confirmed local listings site.
const LONDON_EVENTS_URL = "https://www.timeout.com/london/things-to-do";
const RICHMOND_EVENTS_URL = "https://www.visitrichmond.co.uk/events/";

function boroughFallbackHistory(outcode: string, boroughName: string): HistoryData {
  const summary = BOROUGH_HISTORY[boroughName];
  return {
    summary: summary ? `${outcode} lies within ${boroughName}. ${summary}` : `${outcode} lies within ${boroughName}.`,
    keyFacts: summary ? [summary] : [],
  };
}

async function main() {
  // Places/events/history are genuinely borough-specific (a shared outcode
  // shown on two boroughs' pages should show each borough's own curated
  // content), so use every (borough, outcode) pair, not the deduped index.
  const pairs = await loadOutcodeBoroughPairs();

  const places: Record<string, PlacesData> = {};
  const events: Record<string, EventsData> = {};
  const history: Record<string, HistoryData> = {};

  for (const entry of pairs) {
    const boroughName = entry.borough;
    const outcode = entry.outcode.outcode;
    const key = boroughOutcodeKey(entry.boroughSlug, outcode);
    places[key] = { places: OUTCODE_PLACES[outcode] ?? BOROUGH_PLACES[boroughName] ?? [] };
    events[key] = {
      events: [],
      listingUrl: boroughName === "Richmond upon Thames" ? RICHMOND_EVENTS_URL : LONDON_EVENTS_URL,
    };
    history[key] = OUTCODE_HISTORY[outcode]
      ? { summary: OUTCODE_HISTORY[outcode], keyFacts: [BOROUGH_HISTORY[boroughName] ?? ""].filter(Boolean) }
      : boroughFallbackHistory(outcode, boroughName);
  }

  await mkdir(RAW_DIR, { recursive: true });
  await Promise.all([
    writeFile(path.join(RAW_DIR, "places-by-outcode.json"), JSON.stringify(places, null, 2)),
    writeFile(path.join(RAW_DIR, "events-by-outcode.json"), JSON.stringify(events, null, 2)),
    writeFile(path.join(RAW_DIR, "history-by-outcode.json"), JSON.stringify(history, null, 2)),
  ]);
  logStep(STEP, `Wrote curated places/events/history for ${pairs.length} outcode pages.`);
}

main().catch((err) => {
  console.error(`[${STEP}] FAILED:`, err);
  process.exit(1);
});
