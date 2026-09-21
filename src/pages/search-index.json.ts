import { getPostcodeSearchIndex, getQuickSearchIndex } from "../lib/data";

// The header search needs a list of every district and borough. It used to be embedded in every page (about 90 KB each); now it is one
// static file, fetched the first time someone uses the search box and then cached by the browser and the app's service worker.
export function GET() {
  return new Response(JSON.stringify({ index: getPostcodeSearchIndex(), quick: getQuickSearchIndex() }), { headers: { "Content-Type": "application/json" } });
}
