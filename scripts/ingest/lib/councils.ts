/**
 * Per-borough council system config, populated only from URLs actually
 * verified (via curl/WebFetch, checking real response bodies — not guessed
 * from a naming pattern). `councillorsUrl` is null when no working ModernGov
 * (or equivalent) page was found; `planningSearchUrl` is null when no working
 * planning register page was found. Both are honest gaps, not broken links.
 */
export interface CouncilConfig {
  boroughName: string;
  councillorsUrl: string | null;
  councillorsSystem: "moderngov" | "other" | "none";
  planningSearchUrl: string | null;
}

export const COUNCIL_CONFIG: Record<string, CouncilConfig> = {
  "Barking and Dagenham": {
    boroughName: "Barking and Dagenham",
    councillorsUrl: "https://lbbd.moderngov.co.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://online-befirst.lbbd.gov.uk/planning/index.html?fa=search",
  },
  Barnet: {
    boroughName: "Barnet",
    councillorsUrl: "https://barnet.moderngov.co.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://publicaccess.barnet.gov.uk/online-applications/search.do?action=advanced",
  },
  Bexley: {
    boroughName: "Bexley",
    councillorsUrl: "https://democracy.bexley.gov.uk/mgMemberIndex.aspx?FN=WARD&PIC=0&VW=LIST",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://pa.bexley.gov.uk/online-applications/search.do?action=simple&searchType=Application",
  },
  Brent: {
    boroughName: "Brent",
    councillorsUrl: "https://democracy.brent.gov.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://pa.brent.gov.uk/online-applications/search.do?action=simple",
  },
  Bromley: {
    boroughName: "Bromley",
    councillorsUrl: "https://cds.bromley.gov.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://planningaccess.bromley.gov.uk/pr/s/register-view?c__r=Arcus_BE_Public_Register",
  },
  Camden: {
    boroughName: "Camden",
    councillorsUrl: "https://democracy.camden.gov.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://www.camden.gov.uk/search-for-planning-applications",
  },
  "City of London": {
    boroughName: "City of London",
    councillorsUrl: "https://democracy.cityoflondon.gov.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://www.planning2.cityoflondon.gov.uk/online-applications/",
  },
  Croydon: {
    boroughName: "Croydon",
    councillorsUrl: "https://democracy.croydon.gov.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://publicaccess3.croydon.gov.uk/online-applications/search.do?action=simple&searchType=Application",
  },
  Ealing: {
    boroughName: "Ealing",
    councillorsUrl: "https://ealing.moderngov.co.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://pam.ealing.gov.uk/online-applications/",
  },
  Enfield: {
    boroughName: "Enfield",
    councillorsUrl: "https://governance.enfield.gov.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://planningandbuildingcontrol.enfield.gov.uk/online-applications/",
  },
  Greenwich: {
    boroughName: "Greenwich",
    councillorsUrl: "https://committees.royalgreenwich.gov.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://planning.royalgreenwich.gov.uk/online-applications/",
  },
  Hackney: {
    boroughName: "Hackney",
    councillorsUrl: "https://hackney.moderngov.co.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://developmentandhousing.hackney.gov.uk/planning/index.html",
  },
  "Hammersmith and Fulham": {
    boroughName: "Hammersmith and Fulham",
    councillorsUrl: "https://democracy.lbhf.gov.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://public-access.lbhf.gov.uk/online-applications/search.do?action=simple&searchType=Application",
  },
  Haringey: {
    boroughName: "Haringey",
    councillorsUrl: "https://www.minutes.haringey.gov.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://publicregister.haringey.gov.uk/pr/s/register-view?c__r=Arcus_BE_Public_Register",
  },
  Harrow: {
    boroughName: "Harrow",
    councillorsUrl: "https://moderngov.harrow.gov.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://planningsearch.harrow.gov.uk/planning/index.html?fa=search",
  },
  Havering: {
    boroughName: "Havering",
    councillorsUrl: "https://democracy.havering.gov.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://msp.havering.gov.uk/planning/search-applications",
  },
  Hillingdon: {
    boroughName: "Hillingdon",
    councillorsUrl: "https://modgov.hillingdon.gov.uk/mgMemberIndex.aspx?FN=WARD&PIC=0&VW=LIST",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://planning.hillingdon.gov.uk/OcellaWeb/planningSearch",
  },
  Hounslow: {
    boroughName: "Hounslow",
    councillorsUrl: "https://democraticservices.hounslow.gov.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://planningandbuilding.hounslow.gov.uk/NECSWS/ES/Presentation/Planning/OnlinePlanning/OnlinePlanningSearch",
  },
  Islington: {
    boroughName: "Islington",
    // Fronted by a Cloudflare JS challenge - a plain fetch() at ingest time
    // will not get past it, so councillors will come back empty for this
    // borough even though the URL itself is real and verified in a browser.
    councillorsUrl: "https://islington.moderngov.co.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://planning.agileapplications.co.uk/islington",
  },
  "Kensington and Chelsea": {
    boroughName: "Kensington and Chelsea",
    councillorsUrl: "https://rbkc.moderngov.co.uk/committees/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://www.rbkc.gov.uk/planning/searches/default.aspx?adv=1",
  },
  "Kingston upon Thames": {
    boroughName: "Kingston upon Thames",
    councillorsUrl: "https://kingston.moderngov.co.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://publicaccess.kingston.gov.uk/online-applications/",
  },
  Lambeth: {
    boroughName: "Lambeth",
    councillorsUrl: "https://moderngov.lambeth.gov.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://planning.lambeth.gov.uk/online-applications/",
  },
  Lewisham: {
    boroughName: "Lewisham",
    councillorsUrl: "https://councilmeetings.lewisham.gov.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://planning.lewisham.gov.uk/online-applications/",
  },
  Merton: {
    boroughName: "Merton",
    councillorsUrl: "https://democracy.merton.gov.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://rspandlp.merton.gov.uk/planning/index.html?fa=search",
  },
  "Richmond upon Thames": {
    boroughName: "Richmond upon Thames",
    councillorsUrl: "https://cabnet.richmond.gov.uk/mgMemberIndex.aspx?FN=WARD&PIC=0&VW=LIST",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://planning.richmond.gov.uk/richmond/search-applications/",
  },
  Newham: {
    boroughName: "Newham",
    councillorsUrl: "https://mgov.newham.gov.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://pa.newham.gov.uk/online-applications/",
  },
  Redbridge: {
    boroughName: "Redbridge",
    councillorsUrl: "https://moderngov.redbridge.gov.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://planning.redbridge.gov.uk/",
  },
  Southwark: {
    boroughName: "Southwark",
    councillorsUrl: "https://moderngov.southwark.gov.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://planning.southwark.gov.uk/online-applications/",
  },
  Sutton: {
    boroughName: "Sutton",
    councillorsUrl: "https://moderngov.sutton.gov.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://planningregister.sutton.gov.uk/online-applications/",
  },
  "Tower Hamlets": {
    boroughName: "Tower Hamlets",
    councillorsUrl: "https://democracy.towerhamlets.gov.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://development.towerhamlets.gov.uk/online-applications/",
  },
  "Waltham Forest": {
    boroughName: "Waltham Forest",
    councillorsUrl: "https://democracy.walthamforest.gov.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://www.walthamforest.gov.uk/planning-and-building-control/planning-applications/find-application",
  },
  Wandsworth: {
    boroughName: "Wandsworth",
    councillorsUrl: "https://democracy.wandsworth.gov.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://planning.wandsworth.gov.uk/Northgate/PlanningExplorer/GeneralSearch.aspx",
  },
  Westminster: {
    boroughName: "Westminster",
    councillorsUrl: "https://committees.westminster.gov.uk/mgMemberIndex.aspx?FN=WARD&VW=LIST&PIC=0",
    councillorsSystem: "moderngov",
    planningSearchUrl: "https://idoxpa.westminster.gov.uk/online-applications/",
  },
};
