var net = require("node:net");

function isPrivateAddress(hostname) {
  var normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local")) return true;
  var ipVersion = net.isIP(normalized);
  if (ipVersion === 6) return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
  if (ipVersion !== 4) return false;
  var octets = normalized.split(".").map(function (part) { return Number(part); });
  return octets[0] === 10 || octets[0] === 127 || octets[0] === 0 || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168);
}

function normalizePublicOrigin(value) {
  if (!value) return "";
  var parsed;
  try { parsed = new URL(String(value)); } catch (error) { return ""; }
  if (["http:", "https:"].indexOf(parsed.protocol) < 0 || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash || isPrivateAddress(parsed.hostname)) return "";
  return parsed.origin;
}

function getSiteConfig(env) {
  if (!env) {
    try {
      var generated = require("./site-config.generated.cjs");
      return getSiteConfig({ PUBLIC_DOCS_ORIGIN: generated.publicOrigin, PUBLIC_DOCS_CHANNEL: generated.channel, PUBLIC_DOCS_VERSION: generated.version, PUBLIC_DOCS_STABLE_ORIGIN: generated.stableOrigin, PUBLIC_DOCS_BETA_ORIGIN: generated.betaOrigin });
    } catch (error) { /* Use the environment before the first build. */ }
  }
  var source = env || process.env;
  var publicOrigin = normalizePublicOrigin(source.PUBLIC_DOCS_ORIGIN || source.NEXT_PUBLIC_DOCS_ORIGIN || "");
  var channel = ["stable", "beta"].includes(source.PUBLIC_DOCS_CHANNEL) ? source.PUBLIC_DOCS_CHANNEL : "preview";
  var version = String(source.PUBLIC_DOCS_VERSION || "");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.+_-]{0,39}$/.test(version)) version = "";
  var stableOrigin = normalizePublicOrigin(source.PUBLIC_DOCS_STABLE_ORIGIN);
  var betaOrigin = normalizePublicOrigin(source.PUBLIC_DOCS_BETA_ORIGIN);
  if (channel === "stable" && publicOrigin) stableOrigin = publicOrigin;
  if (channel === "beta" && publicOrigin) betaOrigin = publicOrigin;
  if (stableOrigin && stableOrigin === betaOrigin) { stableOrigin = ""; betaOrigin = ""; }
  return { publicOrigin: publicOrigin, indexable: !!publicOrigin && channel === "stable", channel: channel, version: version, stableOrigin: stableOrigin, betaOrigin: betaOrigin };
}

module.exports = { getSiteConfig: getSiteConfig, normalizePublicOrigin: normalizePublicOrigin };
