"""
ALLL WPS Designer — Gmail SMTP transactional email service.

Usage:
    from backend.api.email_service import send_email

    send_email(
        to="user@example.com",
        subject="Your project was saved",
        body_html="<p>Hello!</p>",
    )

The send is dispatched in a daemon thread so it never blocks a request.
If any of EMAIL_HOST, EMAIL_USER, or EMAIL_PASSWORD are missing a warning
is logged and no exception is raised.
"""

from __future__ import annotations

import logging
import os
import smtplib
import threading
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)

APP_NAME = "ALLL WPS Designer"


def _get_config() -> tuple[str, int, str, str] | None:
    """Return (host, port, user, password) or None if config is incomplete."""
    host = os.environ.get("EMAIL_HOST", "").strip()
    port_str = os.environ.get("EMAIL_PORT", "587").strip()
    user = os.environ.get("EMAIL_USER", "").strip()
    pwd = os.environ.get("EMAIL_PASSWORD", "").strip()

    if not host or not user or not pwd:
        missing = [k for k, v in {"EMAIL_HOST": host, "EMAIL_USER": user, "EMAIL_PASSWORD": pwd}.items() if not v]
        logger.warning("Email not sent — missing env vars: %s", ", ".join(missing))
        return None

    try:
        port = int(port_str)
    except ValueError:
        port = 587

    return host, port, user, pwd


def _send_sync(to: str, subject: str, body_html: str) -> None:
    """Blocking SMTP send — run inside a daemon thread."""
    cfg = _get_config()
    if cfg is None:
        return

    host, port, user, pwd = cfg
    support_email = os.environ.get("SUPPORT_EMAIL", "support@alll-ai.com")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{APP_NAME} <{user}>"
    msg["To"] = to

    plain = (
        body_html
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("</p>", "\n\n")
        .replace("</li>", "\n")
    )
    import re
    plain = re.sub(r"<[^>]+>", "", plain).strip()
    plain += f"\n\n---\nNeed help? Contact us at {support_email}"

    msg.attach(MIMEText(plain, "plain"))
    msg.attach(MIMEText(body_html, "html"))

    try:
        with smtplib.SMTP(host, port, timeout=15) as smtp:
            smtp.ehlo()
            smtp.starttls()
            smtp.login(user, pwd)
            smtp.sendmail(user, [to], msg.as_string())
        logger.info("Email sent to %s — subject: %s", to, subject)
    except Exception as exc:
        logger.error("Failed to send email to %s: %s", to, exc)


def send_email(to: str, subject: str, body_html: str) -> None:
    """
    Fire-and-forget transactional email.

    Dispatches the SMTP send in a daemon thread so the calling request
    returns immediately.  Any SMTP errors are logged but never propagated.
    """
    if not to or "@" not in to:
        logger.warning("send_email: invalid or empty recipient '%s' — skipped", to)
        return

    t = threading.Thread(target=_send_sync, args=(to, subject, body_html), daemon=True)
    t.start()


# ---------------------------------------------------------------------------
# Pre-built email templates
# ---------------------------------------------------------------------------

def send_project_saved(to: str, project_name: str, is_update: bool = False) -> None:
    """Send a project saved / updated confirmation email."""
    action = "updated" if is_update else "saved"
    support_email = os.environ.get("SUPPORT_EMAIL", "support@alll-ai.com")
    subject = f"{APP_NAME} — Project {action}: {project_name}"
    body = f"""
<html><body style="font-family:Arial,sans-serif;color:#1e293b;max-width:560px;margin:auto;padding:24px">
  <img src="https://alll.ai/wps-logo.png" alt="{APP_NAME}" style="height:40px;margin-bottom:16px" onerror="this.style.display='none'">
  <h2 style="color:#0f766e;margin-bottom:8px">Project {action}</h2>
  <p>Your project <strong>{project_name}</strong> has been {action} successfully in {APP_NAME}.</p>
  <p style="color:#64748b;font-size:13px">
    You can access your projects at any time by signing in to {APP_NAME}.<br>
    Questions? Email <a href="mailto:{support_email}" style="color:#0f766e">{support_email}</a>
  </p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
  <p style="font-size:11px;color:#94a3b8">
    {APP_NAME} · Municipal Drinking-Water Pump Station Design<br>
    This is an automated notification — please do not reply to this email.
  </p>
</body></html>
""".strip()
    send_email(to, subject, body)


def send_report_exported(
    to: str,
    project_name: str,
    design_flow_m3h: float | None,
    tdh_m: float | None,
    report_format: str = "Word",
) -> None:
    """Send a confirmation email when a design report is exported."""
    support_email = os.environ.get("SUPPORT_EMAIL", "support@alll-ai.com")
    subject = f"{APP_NAME} — Report exported: {project_name}"

    flow_str = f"{design_flow_m3h:.2f} m³/h" if design_flow_m3h is not None else "—"
    tdh_str  = f"{tdh_m:.2f} m" if tdh_m is not None else "—"

    body = f"""
<html><body style="font-family:Arial,sans-serif;color:#1e293b;max-width:560px;margin:auto;padding:24px">
  <img src="https://alll.ai/wps-logo.png" alt="{APP_NAME}" style="height:40px;margin-bottom:16px" onerror="this.style.display='none'">
  <h2 style="color:#0f766e;margin-bottom:8px">Report exported</h2>
  <p>Your <strong>{report_format}</strong> design report for <strong>{project_name}</strong> has been generated successfully.</p>
  <table style="border-collapse:collapse;width:100%;margin:16px 0">
    <tr style="background:#f1f5f9">
      <td style="padding:8px 12px;font-weight:bold;width:50%">Design flow</td>
      <td style="padding:8px 12px">{flow_str}</td>
    </tr>
    <tr>
      <td style="padding:8px 12px;font-weight:bold">Total dynamic head (TDH)</td>
      <td style="padding:8px 12px">{tdh_str}</td>
    </tr>
  </table>
  <p style="color:#64748b;font-size:13px">
    Questions? Email <a href="mailto:{support_email}" style="color:#0f766e">{support_email}</a>
  </p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
  <p style="font-size:11px;color:#94a3b8">
    {APP_NAME} · Municipal Drinking-Water Pump Station Design<br>
    This is an automated notification — please do not reply to this email.
  </p>
</body></html>
""".strip()
    send_email(to, subject, body)


def send_subscription_activated(to: str) -> None:
    """Send a welcome email when a subscription is activated."""
    support_email = os.environ.get("SUPPORT_EMAIL", "support@alll-ai.com")
    subject = f"Welcome to {APP_NAME} — Subscription activated"
    body = f"""
<html><body style="font-family:Arial,sans-serif;color:#1e293b;max-width:560px;margin:auto;padding:24px">
  <h2 style="color:#0f766e;margin-bottom:8px">Welcome to {APP_NAME}!</h2>
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
    Email us at <a href="mailto:{support_email}" style="color:#0f766e">{support_email}</a>
  </p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
  <p style="font-size:11px;color:#94a3b8">
    {APP_NAME} · Municipal Drinking-Water Pump Station Design<br>
    This is an automated notification — please do not reply to this email.
  </p>
</body></html>
""".strip()
    send_email(to, subject, body)


def send_subscription_lapsed(to: str) -> None:
    """Send an expiry warning when a subscription is cancelled/deleted."""
    support_email = os.environ.get("SUPPORT_EMAIL", "support@alll-ai.com")
    subject = f"{APP_NAME} — Subscription expired"
    body = f"""
<html><body style="font-family:Arial,sans-serif;color:#1e293b;max-width:560px;margin:auto;padding:24px">
  <h2 style="color:#b45309;margin-bottom:8px">Your subscription has expired</h2>
  <p>Your {APP_NAME} subscription has ended and your access to the app has been suspended.</p>
  <p>To continue using {APP_NAME}, please renew your subscription:</p>
  <a href="https://alll.ai/subscribe"
     style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;
            padding:10px 22px;border-radius:8px;font-weight:bold;margin:12px 0">
    Renew subscription
  </a>
  <p style="color:#64748b;font-size:13px">
    If you believe this is an error or need assistance, contact us at<br>
    <a href="mailto:{support_email}" style="color:#0f766e">{support_email}</a>
  </p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
  <p style="font-size:11px;color:#94a3b8">
    {APP_NAME} · Municipal Drinking-Water Pump Station Design<br>
    This is an automated notification — please do not reply to this email.
  </p>
</body></html>
""".strip()
    send_email(to, subject, body)
