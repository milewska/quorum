/**
 * Email helper — sends transactional email via Cloudflare Email Workers.
 *
 * Prerequisites (one-time CF dashboard setup):
 *   1. Enable Email Routing on your domain (Email > Email Routing)
 *   2. Add a verified sender address and set it as the EMAIL_FROM secret
 *   3. The [[send_email]] binding in wrangler.toml wires up env.EMAIL
 */

import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendMail(
  env: Env,
  opts: SendMailOptions
): Promise<void> {
  const from = env.EMAIL_FROM;

  const msg = createMimeMessage();
  msg.setSender({ name: "Quorum", addr: from });
  msg.setRecipient(opts.to);
  msg.setSubject(opts.subject);
  if (opts.text) {
    msg.addMessage({ contentType: "text/plain", data: opts.text });
  }
  msg.addMessage({ contentType: "text/html", data: opts.html });

  const raw = msg.asRaw();
  const message = new EmailMessage(from, opts.to, raw);
  await env.EMAIL.send(message);
}

// ─── Template helpers ─────────────────────────────────────────────────────────

export function quorumReachedOrganizerEmail(
  eventTitle: string,
  eventId: string,
  slotDate: string,
  baseUrl: string
): { subject: string; html: string; text: string } {
  const manageUrl = `${baseUrl}/events/${eventId}/manage`;
  const subject = `✅ Quorum reached — ${eventTitle}`;
  const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin-top:0">Quorum reached!</h2>
  <p>Your event <strong>${eventTitle}</strong> has reached its commitment threshold for the <strong>${slotDate}</strong> slot.</p>
  <p>Head to your event management page to confirm the event and add a registration link for your attendees.</p>
  <p><a href="${manageUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">Manage Event</a></p>
  <p style="color:#6b7280;font-size:0.875rem">If you're not ready to confirm yet, that's fine — the event will stay in "Quorum Reached" status.</p>
</div>`.trim();
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
  const subject = `🎉 ${eventTitle} has reached quorum!`;
  const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin-top:0">Great news — it's happening!</h2>
  <p><strong>${eventTitle}</strong> has reached its commitment threshold for the <strong>${slotDate}</strong> slot.</p>
  <p>The organiser will confirm the event and share a registration link soon. Keep an eye on your inbox.</p>
  <p><a href="${eventUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">View Event</a></p>
</div>`.trim();
  const text = `Great news — "${eventTitle}" has reached quorum for the ${slotDate} slot! The organiser will confirm soon.\n\nView the event: ${eventUrl}`;
  return { subject, html, text };
}

export function eventConfirmedEmail(
  eventTitle: string,
  eventId: string,
  slotDate: string,
  registrationUrl: string,
  baseUrl: string
): { subject: string; html: string; text: string } {
  const eventUrl = `${baseUrl}/events/${eventId}`;
  const subject = `📅 ${eventTitle} is confirmed — register now`;
  const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin-top:0">It's confirmed!</h2>
  <p><strong>${eventTitle}</strong> is officially happening on <strong>${slotDate}</strong>.</p>
  <p>Register your spot using the link below:</p>
  <p><a href="${registrationUrl}" style="display:inline-block;background:#16a34a;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">Register Now</a></p>
  <p><a href="${eventUrl}">View event page</a></p>
</div>`.trim();
  const text = `"${eventTitle}" is confirmed for ${slotDate}!\n\nRegister here: ${registrationUrl}\nEvent page: ${eventUrl}`;
  return { subject, html, text };
}
