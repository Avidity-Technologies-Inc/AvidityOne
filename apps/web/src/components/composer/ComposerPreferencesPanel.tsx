"use client";
import { useComposerPreferences } from "./useComposerPreferences";
export function ComposerPreferencesPanel({ organization = false }: { organization?: boolean }) {
  const { data, error, status, update, retry } = useComposerPreferences(organization);
  const value = organization ? data?.defaults : data?.effective;
  const readOnly = organization && !data?.canManage;
  const locked = readOnly || (!organization && !data?.defaults.allowPersonalFormatting);
  return <section className="panel stack composer-preferences-panel">
    <div className="section-heading"><div><h2>{organization ? "Ticket composer defaults" : "Ticket writing preferences"}</h2><p className="muted">{organization ? "Shared starting format for ticket replies. Personal overrides inherit any unchanged values." : "Saved to your account automatically. Reading zoom changes only your view; message formatting is included in outgoing email."}</p></div></div>
    {error ? <p className="error" role="alert">{error} <button className="button secondary compact-button" onClick={retry}>Retry</button></p> : null}
    {value ? <>
      {locked ? <p className="muted">The organization controls default message formatting. Paste mode and reading zoom remain personal.</p> : null}
      <div className="composer-preferences-grid">
        <label className="field"><span>Message font</span><select className="input" disabled={locked} value={value.fontFamily} onChange={e => update({ fontFamily: e.target.value })}>{data?.fonts.map(font => <option key={font}>{font}</option>)}</select></label>
        <label className="field"><span>Message size (px)</span><select className="input" disabled={locked} value={value.fontSize} onChange={e => update({ fontSize: Number(e.target.value) })}>{Array.from({ length: 23 }, (_, i) => i + 10).map(size => <option key={size}>{size}</option>)}</select></label>
        <label className="field"><span>Message color</span><input aria-label="Default message color" className="input" type="color" disabled={locked} value={value.color} onChange={e => update({ color: e.target.value })} /></label>
        <label className="field"><span>Line spacing</span><select className="input" disabled={locked} value={value.lineHeight} onChange={e => update({ lineHeight: Number(e.target.value) })}>{[1, 1.15, 1.5, 2].map(size => <option key={size}>{size}</option>)}</select></label>
        <label className="field"><span>Default paste behavior</span><select className="input" disabled={readOnly} value={value.pasteMode} onChange={e => update({ pasteMode: e.target.value })}><option value="adapt">Match message formatting</option><option value="keep">Keep source formatting</option><option value="text">Plain text only</option></select></label>
        {!organization ? <label className="field"><span>Reading zoom — only your view</span><select className="input" disabled={readOnly} value={value.displayScale} onChange={e => update({ displayScale: Number(e.target.value) })}>{[100, 110, 125, 150].map(scale => <option value={scale} key={scale}>{scale}%</option>)}</select></label> : <label className="field"><span>Personal default formatting</span><select className="input" disabled={readOnly} value={String(value.allowPersonalFormatting)} onChange={e => update({ allowPersonalFormatting: e.target.value === "true" })}><option value="true">Allow personal overrides</option><option value="false">Use organization defaults</option></select></label>}
      </div>
      <div className="composer-format-sample" style={{ fontFamily: value.fontFamily, fontSize: value.fontSize, color: value.color, lineHeight: value.lineHeight }}>Message preview<br />Thank you for your update. We are reviewing your request.</div>
      <div className="section-heading"><small role="status">{status}</small><button className="button secondary compact-button" disabled={readOnly || status === "Saving…"} onClick={() => update({ reset: true })}>Restore {organization ? "application" : "organization"} defaults</button></div>
    </> : !error ? <p className="muted">Loading preferences…</p> : null}
  </section>;
}
