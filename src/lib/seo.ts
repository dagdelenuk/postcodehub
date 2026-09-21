// Helpers for canonical URLs and schema.org JSON-LD. Pages hand the result to BaseLayout's `jsonLd` prop.

export const SITE_URL = "https://postcodehub.uk";
export const SITE_NAME = "PostcodeHub.UK";
const OGL = "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/";

export function absoluteUrl(pathname: string): string {
  return new URL(pathname, SITE_URL).toString();
}

interface PlaceInput {
  name: string;
  url: string;
  latitude?: number;
  longitude?: number;
  /** A schema.org type: "AdministrativeArea" for boroughs/cities, "Place" for postcode districts. */
  type?: "Place" | "AdministrativeArea" | "City";
  description?: string;
  containedIn?: { name: string; url: string };
}

/** A place (city, borough or postcode district) with coordinates and where it sits. */
export function placeJsonLd({ name, url, latitude, longitude, type = "Place", description, containedIn }: PlaceInput) {
  return {
    "@context": "https://schema.org",
    "@type": type,
    name,
    url: absoluteUrl(url),
    ...(description ? { description } : {}),
    ...(latitude != null && longitude != null ? { geo: { "@type": "GeoCoordinates", latitude, longitude } } : {}),
    ...(containedIn ? { containedInPlace: { "@type": "AdministrativeArea", name: containedIn.name, url: absoluteUrl(containedIn.url) } } : {}),
  };
}

interface DatasetInput {
  name: string;
  description: string;
  url: string;
  /** Where the figures come from, e.g. "ONS Census 2021". */
  sources: string[];
  keywords: string[];
  spatial: { name: string; latitude?: number; longitude?: number };
}

/** The statistics pages are open-data roundups, so they are described as a schema.org Dataset. */
export function datasetJsonLd({ name, description, url, sources, keywords, spatial }: DatasetInput) {
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name,
    description,
    url: absoluteUrl(url),
    keywords,
    license: OGL,
    isAccessibleForFree: true,
    creator: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
    isBasedOn: sources,
    spatialCoverage: {
      "@type": "Place",
      name: spatial.name,
      ...(spatial.latitude != null && spatial.longitude != null ? { geo: { "@type": "GeoCoordinates", latitude: spatial.latitude, longitude: spatial.longitude } } : {}),
    },
  };
}

export const websiteJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: SITE_NAME,
      url: SITE_URL,
      description: "A non-commercial community information hub for UK neighbourhoods, built from open data.",
      inLanguage: "en-GB",
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: absoluteUrl("/favicon.svg"),
    },
  ],
};

/** An ordered list (e.g. a ranking) for search engines. */
export function itemListJsonLd({ name, description, url, items }: { name: string; description: string; url: string; items: { name: string; url: string }[] }) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    description,
    url: absoluteUrl(url),
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    numberOfItems: items.length,
    itemListElement: items.map((item, i) => ({ "@type": "ListItem", position: i + 1, name: item.name, url: absoluteUrl(item.url) })),
  };
}
