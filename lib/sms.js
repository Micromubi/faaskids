// SMS via Termii (Nigeria). Configure TERMII_API_KEY + TERMII_SENDER_ID in Vercel.
export const smsReady = () => Boolean(process.env.TERMII_API_KEY);

export async function sendSms(to, text) {
  if (!smsReady()) return false;
  const r = await fetch('https://api.ng.termii.com/api/sms/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TERMII_API_KEY,
      to,
      from: process.env.TERMII_SENDER_ID || 'FaasKids',
      sms: text,
      type: 'plain',
      channel: process.env.TERMII_CHANNEL || 'dnd' // 'dnd' reaches numbers on DND; 'generic' is cheaper
    })
  });
  if (!r.ok) throw new Error('SMS failed (' + r.status + ')');
  return true;
}
