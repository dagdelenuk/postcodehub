import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logStep } from "./lib/fetch-utils.js";
import { boroughOutcodeKey, loadOutcodeBoroughPairs } from "./lib/geo.js";
import type { EventsData, HistoryData } from "../../src/lib/types.js";

const STEP = "seed";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../data/raw");

/**
 * Events and history have no open API anywhere (this is true of the
 * golders-green.co.uk benchmark too — these are editorial categories). Rather
 * than fabricate specifics we can't verify (exact addresses, invented events),
 * this is hand-curated using only well-established, verifiable facts.
 *
 * Richmond upon Thames has fine-grained OUTCODE-level content (11 outcodes,
 * built first as the POC). Every other borough gets BOROUGH-level content
 * instead — one accurate history summary applied to every outcode in it.
 * Doing Richmond's outcode-level depth of fact-checked research for ~300
 * outcodes across London isn't something that can be done responsibly
 * without real risk of inventing details, so this is deliberately scoped to
 * be verifiable at 33 items.
 *
 * Places used to be curated here too; that category is now sourced live from
 * OpenStreetMap - see fetch-places.ts.
 */

const OUTCODE_HISTORY: Record<string, string> = {
  TW9: "TW9 covers Kew and part of Richmond town, best known worldwide for the Royal Botanic Gardens, Kew — a UNESCO World Heritage Site since 2003 and one of the world's leading botanical research institutions.",
  TW1: "TW1 covers Twickenham, internationally known as the home of England Rugby since Twickenham Stadium opened in 1909. The area also has Georgian riverside heritage around Marble Hill and Strawberry Hill House, Horace Walpole's pioneering Gothic Revival villa.",
  TW10: "TW10 covers Richmond Hill and Ham. The view from Richmond Hill has been protected by Act of Parliament since 1902, making it the only view in England with statutory legal protection.",
  TW11: "TW11 covers Teddington, whose name is linked to the Thames tidal limit at Teddington Lock, the largest lock complex on the river.",
  TW12: "TW12 covers Hampton, home to Bushy Park — London's second-largest Royal Park after Richmond Park itself — and to Garrick's Temple, actor David Garrick's 18th-century riverside tribute to Shakespeare.",
  TW2: "TW2 covers Whitton and part of Twickenham. Kneller Hall, an 18th-century mansion once owned by court painter Sir Godfrey Kneller, was the home of the Royal Military School of Music from 1857 to 2021.",
  TW4: "TW4 covers Hounslow West and Whitton, and includes Hounslow Heath — a surviving fragment of the much larger heath that once covered this part of Middlesex.",
  KT8: "KT8 spans part of Hampton Court, seat of Hampton Court Palace, the former Tudor residence of King Henry VIII.",
  SW13: "SW13 covers Barnes, a historic Thames-side village that lies along the Oxford v Cambridge Boat Race course and is home to the WWT London Wetland Centre.",
  SW14: "SW14 covers Mortlake and East Sheen; the Boat Race finishes near Chiswick Bridge at the Mortlake end of the borough, close to the historic Stag Brewery site.",
};

// One history summary per London borough — the fallback for every outcode
// that doesn't have Richmond's finer per-outcode entries above. Only
// well-established, verifiable facts.
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
  // Events/history are genuinely borough-specific (a shared outcode shown on
  // two boroughs' pages should show each borough's own curated content), so
  // use every (borough, outcode) pair, not the deduped index.
  const pairs = await loadOutcodeBoroughPairs();

  const events: Record<string, EventsData> = {};
  const history: Record<string, HistoryData> = {};

  for (const entry of pairs) {
    const boroughName = entry.borough;
    const outcode = entry.outcode.outcode;
    const key = boroughOutcodeKey(entry.boroughSlug, outcode);
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
    writeFile(path.join(RAW_DIR, "events-by-outcode.json"), JSON.stringify(events, null, 2)),
    writeFile(path.join(RAW_DIR, "history-by-outcode.json"), JSON.stringify(history, null, 2)),
  ]);
  logStep(STEP, `Wrote curated events/history for ${pairs.length} outcode pages.`);
}

main().catch((err) => {
  console.error(`[${STEP}] FAILED:`, err);
  process.exit(1);
});
