import Link from "next/link";
import DocsShell from "../components/DocsShell.jsx";
import Head from "next/head";
import siteConfig from "../lib/site-config.cjs";

export async function getStaticProps() {
  var content = await import("../lib/content.cjs");
  return { props: { documents: await content.getDocumentSummaries(), groups: content.getGroups(), site: siteConfig.getSiteConfig() } };
}

export default function NotFound({ documents, groups, site }) {
  return <DocsShell documents={documents} groups={groups} currentSlug=""><Head><title>Page not found · Clay Studio Docs</title><meta name="description" content="The requested Clay Studio Docs page could not be found." /><meta name="robots" content="noindex,nofollow" /></Head><div className="not-found"><div className="home-kicker">404</div><h1>That page wandered off.</h1><p>The guide you requested does not exist. Try the documentation home instead.</p><Link className="primary-action" href="/">Back to docs</Link></div></DocsShell>;
}
