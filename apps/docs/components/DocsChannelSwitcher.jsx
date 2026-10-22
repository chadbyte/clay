export default function DocsChannelSwitcher({ site }) {
  var channel = site.channel || "preview";
  var labels = { stable: "Stable", beta: "Beta", preview: "Preview" };
  return <div className="docs-channels">
    <div className="docs-channel-status">{labels[channel]}{site.version ? <span>{site.version}</span> : null}</div>
    <div className="docs-channel-options" role="group" aria-label="Documentation channel">
      {["stable", "beta"].map(function (value) {
        var label = labels[value];
        if (value === channel) return <span className="docs-channel-current" aria-current="true" key={value}>{label}</span>;
        var origin = value === "stable" ? site.stableOrigin : site.betaOrigin;
        if (origin) return <a href={origin + "/"} aria-label={"Open " + label + " documentation overview"} key={value}>{label}</a>;
        return <span className="docs-channel-unavailable" aria-disabled="true" title={label + " documentation is not configured"} key={value}>{label}</span>;
      })}
    </div>
  </div>;
}
