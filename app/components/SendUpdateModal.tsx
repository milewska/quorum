import { useState, useRef, useEffect } from "react";
import { useFetcher } from "react-router";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Recipient {
  email: string;
  name: string;
}

interface Props {
  eventId: string;
  eventTitle: string;
  /** All available recipients (committed participants with emails). */
  allRecipients: Recipient[];
  /** Pre-selected emails (from bulk-select on respondent table). */
  preSelected?: string[];
  /** Host name for preview rendering. */
  hostName: string;
  onClose: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SendUpdateModal({
  eventId,
  eventTitle,
  allRecipients,
  preSelected,
  hostName,
  onClose,
}: Props) {
  const fetcher = useFetcher();
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(
    new Set(preSelected ?? allRecipients.map((r) => r.email))
  );
  const [subject, setSubject] = useState(`Update: ${eventTitle}`);
  const [body, setBody] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const previewRef = useRef<HTMLIFrameElement>(null);

  const sending = fetcher.state !== "idle";
  const sent = fetcher.data?.sent != null;
  const sendError = fetcher.data?.error;

  function toggleEmail(email: string) {
    setSelectedEmails((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  function selectAll() {
    setSelectedEmails(new Set(allRecipients.map((r) => r.email)));
  }
  function selectNone() {
    setSelectedEmails(new Set());
  }

  // No auto-close — let the host read the result and dismiss manually
  // (auto-close at 2.5s was too fast and users missed failed emails)

  // Build preview HTML for iframe
  const previewHtml = showPreview
    ? buildPreviewHtml(eventTitle, subject, body, hostName)
    : "";

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal send-update-modal">
        <div className="modal__header">
          <h3 className="modal__title">Send Update</h3>
          <button className="modal__close" onClick={onClose} title="Close">&times;</button>
        </div>

        {sent ? (
          <div className="send-update-success">
            <p style={{ fontSize: "1.5rem", margin: "0 0 0.5rem" }}>
              {fetcher.data.failed === 0 ? "✓" : "⚠"}
            </p>
            <p>
              Sent to <strong>{fetcher.data.sent}</strong> recipient{fetcher.data.sent !== 1 ? "s" : ""}.
              {fetcher.data.failed > 0 && (
                <> <span style={{ color: "#991b1b" }}>{fetcher.data.failed} failed — check Comms tab for details.</span></>
              )}
            </p>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              style={{ marginTop: "1rem" }}
              onClick={onClose}
            >
              Close
            </button>
          </div>
        ) : (
          <fetcher.Form method="post" className="send-update-form">
            <input type="hidden" name="intent" value="send_update" />
            <input type="hidden" name="recipientEmails" value={Array.from(selectedEmails).join(",")} />

            {/* Recipients */}
            <div className="send-update-section">
              <label className="send-update-label">
                To ({selectedEmails.size} of {allRecipients.length})
                <span className="send-update-select-btns">
                  <button type="button" className="btn btn--ghost btn--xs" onClick={selectAll}>All</button>
                  <button type="button" className="btn btn--ghost btn--xs" onClick={selectNone}>None</button>
                </span>
              </label>
              <div className="send-update-recipients">
                {allRecipients.map((r) => (
                  <label key={r.email} className={`send-update-recipient${selectedEmails.has(r.email) ? " send-update-recipient--on" : ""}`}>
                    <input
                      type="checkbox"
                      checked={selectedEmails.has(r.email)}
                      onChange={() => toggleEmail(r.email)}
                      className="sr-only"
                    />
                    <span className="send-update-recipient__name">{r.name}</span>
                    <span className="send-update-recipient__email">{r.email}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Subject */}
            <div className="send-update-section">
              <label className="send-update-label" htmlFor="update-subject">Subject</label>
              <input
                id="update-subject"
                name="subject"
                type="text"
                className="field__input"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
              />
            </div>

            {/* Body */}
            <div className="send-update-section">
              <label className="send-update-label" htmlFor="update-body">
                Message
                <span style={{ marginLeft: "auto", fontWeight: 400, color: "var(--color-muted)" }}>
                  {body.length} chars
                </span>
              </label>
              <textarea
                id="update-body"
                name="body"
                className="field__input field__textarea"
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Type your message to participants..."
                required
              />
            </div>

            {/* Preview toggle */}
            <div className="send-update-section">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setShowPreview(!showPreview)}
              >
                {showPreview ? "Hide preview" : "Preview email"}
              </button>
              {showPreview && (
                <div className="send-update-preview">
                  <iframe
                    ref={previewRef}
                    srcDoc={previewHtml}
                    title="Email preview"
                    className="send-update-preview__iframe"
                    sandbox="allow-same-origin allow-popups"
                  />
                </div>
              )}
            </div>

            {sendError && <p className="send-update-error">{sendError}</p>}

            {/* Actions */}
            <div className="send-update-actions">
              <button type="button" className="btn btn--ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={sending || selectedEmails.size === 0 || !subject.trim() || !body.trim()}
              >
                {sending ? "Sending..." : `Send to ${selectedEmails.size} recipient${selectedEmails.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          </fetcher.Form>
        )}
      </div>
    </div>
  );
}

// ─── Preview HTML builder (client-side mirror of server template) ────────────

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildPreviewHtml(eventTitle: string, subject: string, body: string, hostName: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f0fdfa;font-family:-apple-system,BlinkMacSystemFont,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdfa">
<tr><td align="center" style="padding:24px 16px">
  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;border:1px solid #ccfbf1;overflow:hidden">
    <tr><td style="background:#0d9488;padding:16px 24px">
      <table width="100%"><tr>
        <td style="color:#fff;font-size:14px;font-weight:700">QUORUM</td>
        <td align="right" style="color:rgba(255,255,255,0.8);font-size:12px">${escHtml(eventTitle)}</td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:28px 24px;color:#1e293b;font-size:15px;line-height:1.6">
      <p style="margin-top:0;margin-bottom:4px;color:#64748b;font-size:14px">Hi there,</p>
      <h2 style="margin-top:8px;margin-bottom:12px;color:#1e293b">Update from ${escHtml(hostName)}</h2>
      <div style="white-space:pre-line">${escHtml(body || "(Your message here)")}</div>
    </td></tr>
    <tr><td style="padding:16px 24px;border-top:1px solid #ccfbf1;color:#64748b;font-size:12px">
      This message was sent by the event host via Quorum.
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}
