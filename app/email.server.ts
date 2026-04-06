/**
 * Email helper — sends transactional email via Resend + logs to D1.
 * QUOR-REWORK Phase C: branded shell, sendAndLog, host-update template.
 */

import { Resend } from "resend";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { emailSends } from "../db/schema";

const FROM = "Quorum <quorum@malamaconsulting.com>";

// ─── Brand colors ────────────────────────────────────────────────────────────
const BRAND = {
  primary: "#0d9488",    // teal-600 (Malama green)
  primaryDark: "#0f766e",
  surface: "#f0fdfa",    // teal-50
  text: "#1e293b",       // slate-800
  muted: "#64748b",      // slate-500
  border: "#ccfbf1",     // teal-100
  white: "#ffffff",
  cta: "#0d9488",
  ctaDanger: "#6b7280",
  ctaSuccess: "#16a34a",
};

// ─── Branded shell ───────────────────────────────────────────────────────────

/** Wraps email body HTML in the Quorum branded shell. */
export function emailShell(opts: {
  eventTitle: string;
  body: string;
  footerText?: string;
}): string {
  const footer = opts.footerText ?? "This is a one-time notification from Quorum.";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BRAND.surface};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.surface}">
<tr><td align="center" style="padding:24px 16px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${BRAND.white};border-radius:12px;border:1px solid ${BRAND.border};overflow:hidden">
    <!-- Header -->
    <tr><td style="background:${BRAND.primary};padding:16px 24px">
      <table role="presentation" width="100%"><tr>
        <td style="color:${BRAND.white};font-size:14px;font-weight:700;letter-spacing:0.5px">QUORUM</td>
        <td align="right" style="color:rgba(255,255,255,0.8);font-size:12px">${escHtml(opts.eventTitle)}</td>
      </tr></table>
    </td></tr>
    <!-- Body -->
    <tr><td style="padding:28px 24px;color:${BRAND.text};font-size:15px;line-height:1.6">
      ${opts.body}
    </td></tr>
    <!-- Footer -->
    <tr><td style="padding:16px 24px;border-top:1px solid ${BRAND.border};color:${BRAND.muted};font-size:12px;line-height:1.5">
      ${escHtml(footer)}<br>
      Powered by <a href="https://quorum.malamaconsulting.com" style="color:${BRAND.primary};text-decoration:none">Quorum</a> &middot; Malama Consulting
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Branded CTA button */
function ctaButton(href: string, label: string, color?: string): string {
  const bg = color ?? BRAND.cta;
  return `<a href="${href}" style="display:inline-block;background:${bg};color:${BRAND.white};padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">${escHtml(label)}</a>`;
}

// ─── Send + Log ──────────────────────────────────────────────────────────────

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/** Plain send (no logging). Used by callers that do their own logging. */
export async function sendMail(
  env: Env,
  opts: SendMailOptions
): Promise<void> {
  const resend = new Resend(env.RESEND_API_KEY);
  await resend.emails.send({
    from: FROM,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
}

/** Send email AND log to email_sends table. Returns {status, error?}. */
export async function sendAndLog(
  env: Env,
  db: DrizzleD1Database<any>,
  eventId: string,
  templateName: string,
  opts: SendMailOptions
): Promise<{ status: "sent" | "failed"; error?: string }> {
  try {
    await sendMail(env, opts);
    await db.insert(emailSends).values({
      eventId,
      recipientEmail: opts.to,
      subject: opts.subject,
      templateName,
      status: "sent",
    });
    return { status: "sent" };
  } catch (e: any) {
    const errMsg = e?.message ?? String(e);
    console.error("Email send failed:", opts.to, errMsg);
    await db.insert(emailSends).values({
      eventId,
      recipientEmail: opts.to,
      subject: opts.subject,
      templateName,
      status: "failed",
      errorMsg: errMsg,
    }).catch(() => {}); // don't throw on log failure
    return { status: "failed", error: errMsg };
  }
}

// ─── Template helpers (all using branded shell) ──────────────────────────────

export function quorumReachedOrganizerEmail(
  eventTitle: string,
  eventId: string,
  slotDate: string,
  baseUrl: string
): { subject: string; html: string; text: string } {
  const manageUrl = `${baseUrl}/events/${eventId}/manage`;
  const subject = `Quorum reached — ${eventTitle}`;
  const body = `
    <h2 style="margin-top:0;color:${BRAND.text}">Quorum reached!</h2>
    <p>Your event <strong>${escHtml(eventTitle)}</strong> has reached its commitment threshold for the <strong>${escHtml(slotDate)}</strong> slot.</p>
    <p>Head to your event management page to confirm the event and add a registration link.</p>
    <p style="padding:8px 0">${ctaButton(manageUrl, "Manage Event")}</p>
    <p style="color:${BRAND.muted};font-size:13px">If you're not ready to confirm yet, the event will stay in "Quorum Reached" status.</p>`;
  const html = emailShell({ eventTitle, body });
  const text = `Quorum reached!\n\nYour event "${eventTitle}" has reached its commitment threshold for the ${slotDate} slot.\n\nManage it here: ${manageUrl}`;
  return { subject, html, text };
}

export function quorumReachedParticipantEmail(
  eventTitle: string,
  eventId: string,
  slotDate: string,
  baseUrl: string
): { subject: string; html: string; text: string } {
  const eventUrl = `${baseUrl}/events/${eventId}`;
  const subject = `${eventTitle} has reached quorum!`;
  const body = `
    <h2 style="margin-top:0;color:${BRAND.text}">Great news — it's happening!</h2>
    <p><strong>${escHtml(eventTitle)}</strong> has reached its commitment threshold for the <strong>${escHtml(slotDate)}</strong> slot.</p>
    <p>The organiser will confirm the event and share a registration link soon.</p>
    <p style="padding:8px 0">${ctaButton(eventUrl, "View Event")}</p>`;
  const html = emailShell({ eventTitle, body });
  const text = `Great news — "${eventTitle}" has reached quorum for the ${slotDate} slot! The organiser will confirm soon.\n\nView the event: ${eventUrl}`;
  return { subject, html, text };
}

export function eventConfirmedEmail(
  eventTitle: string,
  eventId: string,
  slotDate: string,
  registrationUrl: string,
  baseUrl: string,
  hostMessage?: string | null
): { subject: string; html: string; text: string } {
  const eventUrl = `${baseUrl}/events/${eventId}`;
  const subject = `${eventTitle} is confirmed — register now`;
  const hostNote = hostMessage?.trim()
    ? `<div style="background:${BRAND.surface};border-left:3px solid ${BRAND.primary};padding:12px 16px;margin:12px 0;border-radius:0 6px 6px 0;font-size:14px"><strong>Note from the host:</strong><br>${escHtml(hostMessage.trim()).replace(/\n/g, "<br>")}</div>`
    : "";
  const body = `
    <h2 style="margin-top:0;color:${BRAND.text}">It's confirmed!</h2>
    <p><strong>${escHtml(eventTitle)}</strong> is officially happening on <strong>${escHtml(slotDate)}</strong>.</p>
    ${hostNote}
    <p>Register your spot using the link below:</p>
    <p style="padding:8px 0">${ctaButton(registrationUrl, "Register Now", BRAND.ctaSuccess)}</p>
    <p><a href="${eventUrl}" style="color:${BRAND.primary}">View event page</a></p>`;
  const html = emailShell({ eventTitle, body });
  const text = `"${eventTitle}" is confirmed for ${slotDate}!${hostMessage ? `\n\nFrom the host: ${hostMessage}` : ""}\n\nRegister here: ${registrationUrl}\nEvent page: ${eventUrl}`;
  return { subject, html, text };
}

export function eventExpiredOrganizerEmail(
  eventTitle: string,
  eventId: string,
  baseUrl: string
): { subject: string; html: string; text: string } {
  const eventUrl = `${baseUrl}/events/${eventId}`;
  const subject = `${eventTitle} has expired`;
  const body = `
    <h2 style="margin-top:0;color:${BRAND.text}">Your event has expired</h2>
    <p>Unfortunately, <strong>${escHtml(eventTitle)}</strong> didn't reach its commitment threshold before the deadline.</p>
    <p>You can create a new event and try again anytime.</p>
    <p><a href="${eventUrl}" style="color:${BRAND.primary}">View the event page</a></p>`;
  const html = emailShell({ eventTitle, body });
  const text = `Your event "${eventTitle}" didn't reach quorum before the deadline.\n\nView it here: ${eventUrl}`;
  return { subject, html, text };
}

export function slotLostQuorumOrganizerEmail(
  eventTitle: string,
  eventId: string,
  slotDate: string,
  newCount: number,
  threshold: number,
  baseUrl: string
): { subject: string; html: string; text: string } {
  const manageUrl = `${baseUrl}/events/${eventId}/manage`;
  const subject = `${eventTitle} — slot dropped below quorum`;
  const body = `
    <h2 style="margin-top:0;color:${BRAND.text}">Heads up — a slot lost quorum</h2>
    <p>A participant withdrew from the <strong>${escHtml(slotDate)}</strong> slot of <strong>${escHtml(eventTitle)}</strong>.</p>
    <p>Current commitments: <strong>${newCount} / ${threshold}</strong>. The slot is back to active status.</p>
    <p style="color:${BRAND.muted};font-size:13px">You can still confirm at any time — quorum is a floor, not a ceiling.</p>
    <p style="padding:8px 0">${ctaButton(manageUrl, "Manage Event", BRAND.ctaDanger)}</p>`;
  const html = emailShell({ eventTitle, body });
  const text = `A participant withdrew from the ${slotDate} slot of "${eventTitle}". It's now at ${newCount}/${threshold} and back to active.\n\nManage: ${manageUrl}`;
  return { subject, html, text };
}

export function eventExpiredParticipantEmail(
  eventTitle: string,
  eventId: string,
  baseUrl: string
): { subject: string; html: string; text: string } {
  const eventsUrl = `${baseUrl}/events`;
  const subject = `${eventTitle} didn't reach quorum`;
  const body = `
    <h2 style="margin-top:0;color:${BRAND.text}">Not this time</h2>
    <p><strong>${escHtml(eventTitle)}</strong> didn't reach its commitment threshold before the deadline.</p>
    <p>Keep an eye out for other events — maybe the organiser will try again!</p>
    <p style="padding:8px 0">${ctaButton(eventsUrl, "Browse Events", BRAND.ctaDanger)}</p>`;
  const html = emailShell({ eventTitle, body });
  const text = `"${eventTitle}" didn't reach quorum before the deadline. Check out other events: ${eventsUrl}`;
  return { subject, html, text };
}

/** Host ad-hoc update email (C3: Send Update) */
export function hostUpdateEmail(
  eventTitle: string,
  eventId: string,
  subject: string,
  messageBody: string,
  hostName: string,
  baseUrl: string
): { subject: string; html: string; text: string } {
  const eventUrl = `${baseUrl}/events/${eventId}`;
  const body = `
    <h2 style="margin-top:0;color:${BRAND.text}">Update from ${escHtml(hostName)}</h2>
    <div style="white-space:pre-line;line-height:1.6">${escHtml(messageBody)}</div>
    <p style="padding:12px 0">${ctaButton(eventUrl, "View Event")}</p>`;
  const html = emailShell({
    eventTitle,
    body,
    footerText: `This message was sent by the event host via Quorum.`,
  });
  const text = `Update from ${hostName} about "${eventTitle}":\n\n${messageBody}\n\nView event: ${eventUrl}`;
  return { subject, html, text };
}

/** Generates preview HTML for the Send Update modal (C5). */
export function previewHostUpdateHtml(
  eventTitle: string,
  subject: string,
  messageBody: string,
  hostName: string
): string {
  const body = `
    <h2 style="margin-top:0;color:${BRAND.text}">Update from ${escHtml(hostName)}</h2>
    <div style="white-space:pre-line;line-height:1.6">${escHtml(messageBody || "(Your message will appear here)")}</div>
    <p style="padding:12px 0">${ctaButton("#", "View Event")}</p>`;
  return emailShell({
    eventTitle,
    body,
    footerText: `This message was sent by the event host via Quorum.`,
  });
}
