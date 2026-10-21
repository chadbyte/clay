import Link from "next/link";
import Head from "next/head";
import DocsShell from "../components/DocsShell.jsx";
import siteConfig from "../lib/site-config.cjs";

export async function getStaticProps() {
  var content = await import("../lib/content.cjs");
  return { props: { documents: await content.getDocumentSummaries(), groups: content.getGroups(), site: siteConfig.getSiteConfig() } };
}

function ArrowIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" /></svg>;
}

function IndexPage({ documents, groups, site }) {
  var origin = site.publicOrigin;
  var visibleGroups = groups.filter(function (group) { return group.visible !== false; });
  return <DocsShell documents={documents} groups={groups} currentSlug="">
    <Head><title>Clay Studio Docs</title><meta name="description" content="Guides for installing Clay Studio and working with projects, sessions, Mates, and Split Workers." /><meta name="robots" content={site.indexable ? "index,follow" : "noindex,nofollow"} />{origin ? <><link rel="canonical" href={origin + "/"} /><meta property="og:title" content="Clay Studio Docs" /><meta property="og:description" content="Practical guides for Clay Studio." /><meta property="og:url" content={origin + "/"} /></> : null}</Head>
    <div className="home-kicker">Clay Studio documentation</div>
    <h1 className="home-title">Clay Studio Docs</h1>
    <p className="home-lede">Guides for installing Clay Studio and working with projects, sessions, Mates, and Split Workers.</p>
    <div className="home-actions">
      <Link className="primary-action" href="/docs/getting-started">Get started <ArrowIcon /></Link>
      <a className="text-action" href="https://github.com/chadbyte/clay" target="_blank" rel="noreferrer">View on GitHub <span aria-hidden="true">↗</span></a>
    </div>
    <div className="home-grid">{visibleGroups.map(function (group) { return <section className="home-section" key={group.id}><div className="section-label">{group.title}</div>{group.pages.map(function (page) { var document = documents.find(function (item) { return item.slug === page[0]; }); return <Link className="guide-card" href={"/docs/" + document.slug} key={document.slug}><span><strong>{document.title}</strong><small>{document.description}</small></span><ArrowIcon /></Link>; })}</section>; })}</div>
    <div className="home-note"><span className="signal-dot" aria-hidden="true"></span><span>Clay Studio runs on your machine. Your code stays close to the work.</span></div>
  </DocsShell>;
}

export default IndexPage;
