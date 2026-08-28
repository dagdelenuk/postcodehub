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
    { name: "Kew Palace", category: "community-hub", address: "Kew Green, Richmond upon Thames, TW9 3AB", description: "The smallest of the UK's royal palaces, once a country retreat for George III's family, set within Kew Gardens." },
  ],
  TW1: [
    { name: "Twickenham Stadium", category: "leisure-centre", address: "Twickenham, TW1", description: "The home of England Rugby, and the world's second-largest rugby union venue." },
    { name: "Marble Hill Park", category: "park", address: "Twickenham, TW1", description: "Riverside park surrounding Marble Hill House, an English Heritage Palladian villa." },
    { name: "Eel Pie Island", category: "community-hub", address: "Twickenham, TW1 3DY", description: "A small Thames island reached by footbridge, home to a long-standing community of artists' studios and once a famous 1960s music venue." },
    { name: "Strawberry Hill House", category: "community-hub", address: "268 Waldegrave Road, Twickenham, TW1 4ST", description: "Horace Walpole's 18th-century Gothic Revival villa, Britain's best-known example of the style." },
  ],
  TW10: [
    { name: "Ham House and Garden", category: "community-hub", address: "Ham, Richmond upon Thames, TW10", description: "A National Trust 17th-century house on the banks of the Thames." },
    { name: "Richmond Hill", category: "park", address: "Richmond, TW10", description: "Home to the View from Richmond Hill, the only view in England protected by its own Act of Parliament." },
    { name: "Petersham Meadows", category: "park", address: "River Lane, Richmond, TW10 7AG", description: "A historic Thames-side water meadow between Richmond and Ham, protected by the same 1902 Act of Parliament and still grazed by cattle each summer." },
  ],
  TW11: [
    { name: "Teddington Lock", category: "park", address: "Teddington, TW11", description: "The largest lock complex on the Thames and the river's tidal limit." },
    { name: "Landmark Arts Centre", category: "community-hub", address: "Ferry Road, Teddington, TW11 9NN", description: "A Grade II listed former Victorian church on the riverside, now a community arts venue for exhibitions, concerts, and events." },
    { name: "Bushy Park", category: "park", address: "Teddington, TW11", description: "London's second-largest Royal Park, known for its wild deer herds and Chestnut Avenue; its Teddington side borders TW11." },
  ],
  TW12: [
    { name: "Bushy Park", category: "park", address: "Hampton, TW12", description: "London's second-largest Royal Park, known for its wild deer herds and Chestnut Avenue." },
    { name: "Garrick's Temple to Shakespeare", category: "community-hub", address: "Hampton Court Road, Hampton, TW12 2EN", description: "A riverside garden temple built in 1756 by actor David Garrick in tribute to Shakespeare, now a small museum." },
  ],
  TW2: [
    { name: "Kneller Hall", category: "community-hub", address: "Kneller Road, Whitton, TW2 7DU", description: "A Grade II listed 18th-century mansion, home to the Royal Military School of Music from 1857 until the Army vacated the site in 2021." },
  ],
  TW4: [
    { name: "Hounslow Heath", category: "park", address: "Hounslow, TW4", description: "A large surviving remnant of the once much larger Hounslow Heath, today a local nature reserve." },
  ],
  KT1: [
    { name: "Royal Paddocks Allotments", category: "community-hub", address: "Hampton Wick, KT1", description: "Allotments granted by Royal Warrant in 1921 on the site of the king's former horse paddocks, enclosed within the walls of Bushy Park." },
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
    { name: "Stag Brewery site", category: "community-hub", address: "Lower Richmond Road, Mortlake, SW14", description: "Site of the Mortlake Brewery, brewing on and off since the 15th century and known as the Stag Brewery from 1959 until closure in 2015; now being redeveloped." },
  ],
};

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
  "Barking and Dagenham": [
    { name: "Eastbrookend Country Park", category: "park", address: "Dagenham", description: "A large country park with lakes and nature trails on the site of former gravel pits." },
    { name: "Valence House Museum", category: "community-hub", address: "Becontree Avenue, Dagenham, RM8 3HT", description: "A moated medieval manor house, now a free local history museum for the borough." },
  ],
  Barnet: [
    { name: "RAF Museum London", category: "community-hub", address: "Hendon", description: "The Royal Air Force's national museum, built around historic Hendon Aerodrome." },
    { name: "Hadley Highstone", category: "community-hub", address: "Great North Road, Monken Hadley, EN5 4QQ", description: "An 18th-century obelisk marking the site of the 1471 Battle of Barnet, a decisive clash in the Wars of the Roses." },
  ],
  Bexley: [
    { name: "Hall Place and Gardens", category: "community-hub", address: "Bexley", description: "A Tudor manor house with Grade I and II listed formal gardens, open to the public." },
    { name: "Danson House", category: "community-hub", address: "Danson Park, Bexleyheath, DA6 8HL", description: "A Grade I listed Palladian villa built in the 1760s, at the centre of Danson Park." },
  ],
  Brent: [
    { name: "Wembley Stadium", category: "leisure-centre", address: "Wembley", description: "England's national football stadium, with an 90,000 capacity." },
    { name: "BAPS Shri Swaminarayan Mandir", category: "community-hub", address: "105-119 Brentfield Road, Neasden, NW10 8LD", description: "The largest traditional Hindu stone temple outside India, opened in 1995 and known as Neasden Temple." },
  ],
  Bromley: [
    { name: "Crystal Palace Park", category: "park", address: "Bromley/Croydon border", description: "A large Victorian park containing the world-famous Crystal Palace Dinosaurs sculptures." },
    { name: "Down House", category: "community-hub", address: "Luxted Road, Downe, BR6 7JT", description: "Charles Darwin's family home for 40 years, where he wrote On the Origin of Species; now an English Heritage museum." },
  ],
  Camden: [
    { name: "Camden Market", category: "community-hub", address: "Camden Town", description: "One of the UK's most visited attractions, a sprawling market for fashion, food, and crafts." },
    { name: "British Museum", category: "community-hub", address: "Great Russell Street, WC1B 3DG", description: "One of the world's great museums of human history and culture, free to enter since its founding in 1753." },
  ],
  "City of London": [
    { name: "St Paul's Cathedral", category: "community-hub", address: "City of London", description: "Sir Christopher Wren's Baroque cathedral, completed in 1710, at the heart of the Square Mile." },
    { name: "Bank of England Museum", category: "community-hub", address: "Bartholomew Lane, EC2R 8AH", description: "A free museum inside the Bank of England telling the story of the UK's central bank since 1694." },
  ],
  Croydon: [
    { name: "Lloyd Park", category: "park", address: "Croydon", description: "A large public park in the shadow of Croydon's historic Addington Hills." },
    { name: "Fairfield Halls", category: "leisure-centre", address: "Park Lane, Croydon, CR9 1DG", description: "Croydon's main concert hall and theatre complex, home to the Ashcroft Theatre." },
  ],
  Ealing: [
    { name: "Walpole Park", category: "park", address: "Ealing", description: "A historic park surrounding Pitzhanger Manor, designed in part by Sir John Soane." },
    { name: "Ealing Studios", category: "community-hub", address: "Ealing Green, W5 5EP", description: "The oldest continuously working film studio facility in the world, in operation since 1902." },
  ],
  Enfield: [
    { name: "Forty Hall", category: "community-hub", address: "Enfield", description: "A Jacobean mansion set in a 275-acre country park, now a museum and gallery." },
    { name: "Myddelton House Gardens", category: "park", address: "Bulls Cross, Enfield, EN2 9HG", description: "Historic gardens developed by plantsman E. A. Bowles, now managed by Lee Valley Regional Park." },
  ],
  Greenwich: [
    { name: "Royal Observatory Greenwich", category: "community-hub", address: "Greenwich Park", description: "Home of the Prime Meridian and Greenwich Mean Time, within a UNESCO World Heritage Site." },
    { name: "Cutty Sark", category: "community-hub", address: "King William Walk, Greenwich, SE10 9HT", description: "The last surviving tea clipper ship in the world, preserved as a museum ship since the 1950s." },
  ],
  Hackney: [
    { name: "Victoria Park", category: "park", address: "Hackney/Tower Hamlets border", description: "One of London's oldest public parks, opened in 1845 for the East End." },
    { name: "Hackney Empire", category: "leisure-centre", address: "291 Mare Street, E8 1EJ", description: "A Grade II* listed Edwardian variety theatre, still a leading live entertainment venue today." },
  ],
  "Hammersmith and Fulham": [
    { name: "Bishops Park", category: "park", address: "Fulham", description: "A riverside park next to Fulham Palace, the former residence of the Bishops of London." },
    { name: "Stamford Bridge", category: "leisure-centre", address: "Fulham Road, SW6 1HS", description: "Home of Chelsea Football Club since 1905, despite its name referencing neighbouring Fulham." },
  ],
  Haringey: [
    { name: "Alexandra Palace", category: "community-hub", address: "Alexandra Park", description: "A Victorian entertainment venue on a hilltop park, site of the BBC's first TV broadcasts in 1936." },
    { name: "Bruce Castle Museum", category: "community-hub", address: "Lordship Lane, Tottenham, N17 8NU", description: "A 16th-century manor house, now a free museum of local history for Haringey." },
  ],
  Harrow: [
    { name: "Harrow School", category: "community-hub", address: "Harrow-on-the-Hill", description: "One of England's oldest public schools, founded in 1572." },
    { name: "Headstone Manor and Museum", category: "community-hub", address: "Pinner View, Harrow, HA2 6PX", description: "A moated 14th-century manor house, the oldest of its kind in Middlesex, now Harrow's local museum." },
  ],
  Havering: [
    { name: "Raphael Park", category: "park", address: "Romford", description: "A Victorian park with a boating lake, adjoining the historic Gidea Park estate." },
    { name: "Romford Market", category: "community-hub", address: "Market Place, Romford, RM1 3AB", description: "An outdoor market trading since a royal charter of 1247, still held several days a week." },
  ],
  Hillingdon: [
    { name: "Cranford Country Park", category: "park", address: "Hillingdon", description: "Woodland and meadows around the former Cranford House estate." },
    { name: "Battle of Britain Bunker", category: "community-hub", address: "Wren Avenue, Uxbridge, UB10 0BE", description: "The underground WWII operations room at former RAF Uxbridge that directed fighter squadrons during the Battle of Britain." },
  ],
  Hounslow: [
    { name: "Chiswick House and Gardens", category: "community-hub", address: "Chiswick", description: "A celebrated 18th-century Palladian villa with historic landscape gardens." },
    { name: "Syon House", category: "community-hub", address: "Syon Park, Brentford, TW8 8JF", description: "The London home of the Duke of Northumberland for over 400 years, with interiors by Robert Adam." },
  ],
  Islington: [
    { name: "Sadler's Wells", category: "leisure-centre", address: "Islington", description: "A leading dance theatre with roots going back to a 17th-century well." },
    { name: "Emirates Stadium", category: "leisure-centre", address: "75 Drayton Park, N5 1BU", description: "Arsenal Football Club's home ground since 2006." },
  ],
  "Kensington and Chelsea": [
    { name: "Natural History Museum", category: "community-hub", address: "South Kensington", description: "One of the world's great natural history collections, housed in a landmark Victorian building." },
    { name: "Science Museum", category: "community-hub", address: "Exhibition Road, SW7 2DD", description: "One of the world's leading science museums, part of South Kensington's cluster of free national museums." },
  ],
  "Kingston upon Thames": [
    { name: "Kingston Market Place", category: "community-hub", address: "Kingston upon Thames", description: "A historic market place, home to the ancient Coronation Stone of Anglo-Saxon kings." },
    { name: "Bentall Centre", category: "community-hub", address: "Wood Street, Kingston upon Thames, KT1 1TP", description: "A large town-centre shopping centre built around the historic Bentalls department store." },
  ],
  Lambeth: [
    { name: "Lambeth Palace", category: "community-hub", address: "Lambeth", description: "The official London residence of the Archbishop of Canterbury for over 800 years." },
    { name: "Royal Festival Hall", category: "leisure-centre", address: "Belvedere Road, SE1 8XX", description: "The centrepiece concert hall of the South Bank Centre, built for the 1951 Festival of Britain." },
  ],
  Lewisham: [
    { name: "Horniman Museum and Gardens", category: "community-hub", address: "Forest Hill", description: "A free museum of anthropology and natural history set in 16 acres of gardens." },
    { name: "Manor House Gardens", category: "park", address: "Old Road, Lee, SE13 5TA", description: "A Green Flag-winning park around a Grade II listed 18th-century manor house, with a 250-year-old ice house." },
  ],
  Merton: [
    { name: "All England Lawn Tennis Club", category: "leisure-centre", address: "Wimbledon", description: "Host of the Wimbledon Championships, the oldest tennis tournament in the world, since 1877." },
    { name: "Wimbledon Windmill Museum", category: "community-hub", address: "Windmill Road, Wimbledon Common, SW19 5NQ", description: "A rare surviving hollow-post flour mill on Wimbledon Common, now a small museum." },
  ],
  Newham: [
    { name: "Queen Elizabeth Olympic Park", category: "park", address: "Stratford", description: "The main venue for the London 2012 Olympics, now a public park and sports venue." },
    { name: "ExCeL London", category: "community-hub", address: "Western Gateway, E16 1XL", description: "A major exhibition and convention centre on the Royal Victoria Dock in the Docklands." },
  ],
  Redbridge: [
    { name: "Valentines Park", category: "park", address: "Ilford", description: "A large Victorian park surrounding the historic Valentines Mansion." },
    { name: "Hainault Forest Country Park", category: "park", address: "Romford Road, Hainault, IG7 4QJ", description: "A surviving fragment of the ancient Forest of Essex, with woodland, a lake, and a small farm park." },
  ],
  Southwark: [
    { name: "Borough Market", category: "community-hub", address: "Southwark", description: "One of London's oldest food markets, trading in some form since the 12th century." },
    { name: "Shakespeare's Globe", category: "leisure-centre", address: "21 New Globe Walk, SE1 9DT", description: "A faithful reconstruction of Shakespeare's original Elizabethan theatre, close to its original Bankside site." },
  ],
  Sutton: [
    { name: "Carshalton Park", category: "park", address: "Carshalton", description: "A green space in one of Sutton's oldest villages, known for its ponds and lavender fields nearby." },
    { name: "Nonsuch Park", category: "park", address: "Ewell Road, Sutton, SM3 8AB", description: "Former grounds of Henry VIII's lost Nonsuch Palace, straddling the Sutton and Epsom & Ewell border." },
  ],
  "Tower Hamlets": [
    { name: "Victoria Park", category: "park", address: "Tower Hamlets/Hackney border", description: "One of London's oldest public parks, opened in 1845 for the East End." },
    { name: "Canary Wharf", category: "community-hub", address: "Canary Wharf", description: "One of the UK's two main financial centres, developed from the 1980s on former Docklands land." },
  ],
  "Waltham Forest": [
    { name: "William Morris Gallery", category: "community-hub", address: "Walthamstow", description: "A free gallery in the childhood home of designer and writer William Morris." },
    { name: "Walthamstow Wetlands", category: "park", address: "2 Forest Road, N17 9NH", description: "Europe's largest urban wetland nature reserve, created from Victorian reservoirs still supplying London's drinking water." },
  ],
  Wandsworth: [
    { name: "Battersea Park", category: "park", address: "Battersea", description: "A large Thames-side park opened in 1858, near the landmark Battersea Power Station." },
    { name: "Battersea Power Station", category: "community-hub", address: "188 Kirtling Street, SW8 5BN", description: "The iconic decommissioned coal-fired power station on the Thames, redeveloped into shops, homes, and offices." },
  ],
  Westminster: [
    { name: "Westminster Abbey", category: "community-hub", address: "Westminster", description: "The historic coronation church of English and British monarchs since 1066." },
    { name: "Buckingham Palace", category: "community-hub", address: "Westminster, SW1A 1AA", description: "The monarch's administrative headquarters and London residence since 1837." },
  ],
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
