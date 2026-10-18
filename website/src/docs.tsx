import { DocsApp } from "@/DocsApp";
import { isDocSlug } from "@/lib/docs-pages";
import { sitePath } from "@/lib/site";
import { mount } from "@/mount";

// Every docs HTML entry names its page on the root element; the overview has none.
const slug = document.getElementById("root")?.dataset.page;
const page = isDocSlug(slug) ? slug : "docs";

// The docs used to be one page with an anchor per topic (docs/#build).
// Send those links to the topic's own page.
const legacy = decodeURIComponent(window.location.hash.slice(1));
if (page === "docs" && isDocSlug(legacy)) {
  window.location.replace(sitePath("docs", legacy));
} else {
  mount(<DocsApp page={page} />);
}
