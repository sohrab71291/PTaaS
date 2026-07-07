import nodemailer from 'nodemailer';

function buildSmtpTransport() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user || 'noreply@perfops.local';

  if (!host) return null;
  return {
    transport: nodemailer.createTransport({
      host,
      port,
      auth: user && pass ? { user, pass } : undefined,
      connectionTimeout: 10_000,
      socketTimeout: 10_000,
    }),
    from,
  };
}

export async function sendMail(to: string[], subject: string, html: string): Promise<{ ok: boolean; message: string }> {
  const smtp = buildSmtpTransport();
  if (!smtp) return { ok: false, message: 'SMTP not configured (set SMTP_HOST in .env)' };
  try {
    await smtp.transport.sendMail({ from: smtp.from, to: to.join(','), subject, html });
    return { ok: true, message: `Email sent to ${to.join(', ')}` };
  } catch (err: any) {
    return { ok: false, message: err.message };
  }
}
