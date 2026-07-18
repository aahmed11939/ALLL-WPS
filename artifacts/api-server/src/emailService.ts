/**
 * ALLL WPS Designer — Gmail SMTP transactional email service (Node.js).
 *
 * Uses nodemailer (already available via npm) with the same env vars as the
 * Python backend: EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASSWORD,
 * SUPPORT_EMAIL.
 *
 * All sends are fire-and-forget — errors are logged, never thrown.
 */

import nodemailer from "nodemailer";
import { logger } from "./lib/logger";

const APP_NAME = "ALLL WPS Designer";

function getTransport(): nodemailer.Transporter | null {
  const host = process.env.EMAIL_HOST?.trim();
  const port = parseInt(process.env.EMAIL_PORT ?? "587", 10);
  const user = process.env.EMAIL_USER?.trim();
  const pass = process.env.EMAIL_PASSWORD?.trim();

  const missing = [
    !host && "EMAIL_HOST",
    !user && "EMAIL_USER",
    !pass && "EMAIL_PASSWORD",
  ].filter(Boolean);

  if (missing.length > 0) {
    logger.warn({ missing }, "Email not sent — missing env vars");
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: false,
    auth: { user, pass },
  });
}

async function sendEmail(to: string, subject: string, bodyHtml: string): Promise<void> {
  if (!to || !to.includes("@")) {
    logger.warn({ to }, "sendEmail: invalid or empty recipient — skipped");
    return;
  }

  const transport = getTransport();
  if (!transport) return;

  const user = process.env.EMAIL_USER ?? "";
  const supportEmail = process.env.SUPPORT_EMAIL ?? "support@alll-ai.com";

  const plain = bodyHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim()
    .concat(`\n\n---\nNeed help? Contact us at ${supportEmail}`);

  try {
    await transport.sendMail({
      from: `"${APP_NAME}" <${user}>`,
      to,
      subject,
      text: plain,
      html: bodyHtml,
    });
    logger.info({ to, subject }, "Email sent");
  } catch (err) {
    logger.error({ err, to, subject }, "Failed to send email");
  }
}

export function sendSubscriptionActivated(to: string): void {
  const supportEmail = process.env.SUPPORT_EMAIL ?? "support@alll-ai.com";
  const subject = `Welcome to ${APP_NAME} — Subscription activated`;
  const body = `
<html><body style="font-family:Arial,sans-serif;color:#1e293b;max-width:560px;margin:auto;padding:24px">
  <h2 style="color:#0f766e;margin-bottom:8px">Welcome to ${APP_NAME}!</h2>
  <p>Your annual subscription is now active. You have full access to all features:</p>
  <ul style="color:#334155;line-height:1.8">
    <li>Full hydraulic system design (Darcy-Weisbach + Hazen-Williams)</li>
    <li>Surge/transient analysis using Method of Characteristics</li>
    <li>Pump curve overlay and operating-point finder</li>
    <li>Clearwell sizing and duty-cycle calculations</li>
    <li>Professional PDF / Excel report export</li>
    <li>Unlimited saved projects</li>
  </ul>
  <p style="color:#64748b;font-size:13px">
    Questions or need help getting started?<br>
    Email us at <a href="mailto:${supportEmail}" style="color:#0f766e">${supportEmail}</a>
  </p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
  <p style="font-size:11px;color:#94a3b8">
    ${APP_NAME} · Municipal Drinking-Water Pump Station Design<br>
    This is an automated notification — please do not reply to this email.
  </p>
</body></html>`.trim();

  void sendEmail(to, subject, body);
}

export function sendSubscriptionLapsed(to: string): void {
  const supportEmail = process.env.SUPPORT_EMAIL ?? "support@alll-ai.com";
  const subject = `${APP_NAME} — Subscription expired`;
  const body = `
<html><body style="font-family:Arial,sans-serif;color:#1e293b;max-width:560px;margin:auto;padding:24px">
  <h2 style="color:#b45309;margin-bottom:8px">Your subscription has expired</h2>
  <p>Your ${APP_NAME} subscription has ended and your access to the app has been suspended.</p>
  <p>To continue using ${APP_NAME}, please renew your subscription:</p>
  <a href="https://alll.ai/subscribe"
     style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;
            padding:10px 22px;border-radius:8px;font-weight:bold;margin:12px 0">
    Renew subscription
  </a>
  <p style="color:#64748b;font-size:13px">
    If you believe this is an error or need assistance, contact us at<br>
    <a href="mailto:${supportEmail}" style="color:#0f766e">${supportEmail}</a>
  </p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
  <p style="font-size:11px;color:#94a3b8">
    ${APP_NAME} · Municipal Drinking-Water Pump Station Design<br>
    This is an automated notification — please do not reply to this email.
  </p>
</body></html>`.trim();

  void sendEmail(to, subject, body);
}
