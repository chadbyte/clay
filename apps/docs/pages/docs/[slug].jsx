import Link from "next/link";
import Head from "next/head";
import DocsShell from "../../components/DocsShell.jsx";
import siteConfig from "../../lib/site-config.cjs";

export async function getStaticPaths() {
  var content = await import("../../lib/content.cjs");
  return { paths: (await content.getDocumentSummaries()).map(function (document) { return { params: { slug: document.slug } }; }), fallback: false };
}

export async function getStaticProps({ params }) {
  var content = await import("../../lib/content.cjs");
  return { props: { document: await content.getDocument(params.slug), documents: await content.getDocumentSummaries(), groups: content.getGroups(), site: siteConfig.getSiteConfig() } };
}

function DocPage({ document, documents, groups, site }) {
  var navigationDocuments = documents.filter(function (item) { return !item.legacy; });
  var index = navigationDocuments.findIndex(function (item) { return item.slug === document.slug; });
  var canonicalDocument = documents.find(function (item) { return item.slug === document.canonicalSlug; }) || document;
  var previous = index > 0 ? navigationDocuments[index - 1] : null;
  var next = index >= 0 && index < navigationDocuments.length - 1 ? navigationDocuments[index + 1] : null;
  var canonical = site.publicOrigin ? site.publicOrigin + "/docs/" + canonicalDocument.slug : "";
  return <DocsShell site={site} documents={documents} groups={groups} currentSlug={document.legacy ? canonicalDocument.slug : document.slug}>
    <Head><title>{document.title} · Clay Studio Docs</title><meta name="description" content={document.description} /><meta name="robots" content={site.indexable && !document.legacy ? "index,follow" : "noindex,nofollow"} />{canonical ? <><link rel="canonical" href={canonical} /><meta property="og:title" content={document.title + " · Clay Studio Docs"} /><meta property="og:description" content={document.description} /><meta property="og:url" content={canonical} /></> : null}</Head>
    <div className="breadcrumbs"><Link href="/">Docs</Link><span>/</span><span>{document.group}</span><span>/</span><strong>{document.title}</strong></div>
    <article className="article">
      <div className="article-header"><div className="article-kicker">{document.group}</div><h1>{document.title}</h1><p>{document.description}</p></div>
      <div className="article-layout"><div className="article-body" dangerouslySetInnerHTML={{ __html: document.html }} /><aside className="contents" aria-label="On this page"><div className="contents-title">On this page</div>{document.headings.length ? <nav>{document.headings.map(function (heading) { return <a className="contents-link" href={"#" + heading.id} key={heading.id}>{heading.text}</a>; })}</nav> : <div className="contents-line">This guide is a short overview.</div>}</aside></div>
      <nav className="article-nav" aria-label="Guide navigation">
        {previous ? <Link href={"/docs/" + previous.slug}><span>← Previous</span><strong>{previous.title}</strong></Link> : <span />}
        {next ? <Link className="next" href={"/docs/" + next.slug}><span>Next →</span><strong>{next.title}</strong></Link> : <span />}
      </nav>
    </article>
  </DocsShell>;
}

export default DocPage;
