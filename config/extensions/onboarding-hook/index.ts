// In-memory cache — prevents HTTP call on every message from known users
const knownPhones = new Set<string>();

const ONBOARDING_URL = process.env.ONBOARDING_WEBHOOK_URL || "http://localhost:3000/webhook/onboarding";
const HOOK_TOKEN = process.env.HOOK_TOKEN || "";

export default function register(api: any) {
  api.on("message_received", async (event: any, ctx: any) => {
    if (ctx.channelId !== "whatsapp") return;
    const phone = event.metadata?.senderE164;
    if (!phone || knownPhones.has(phone)) return;

    // Webhook is idempotent (SQLite UNIQUE), duplicate calls safe
    try {
      const resp = await fetch(ONBOARDING_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${HOOK_TOKEN}`,
        },
        body: JSON.stringify({ phone }),
      });

      if (resp.ok) {
        const data = await resp.json();
        knownPhones.add(phone);
        api.logger?.info?.(`[onboarding-hook] ${data.status}: ${phone} → ${data.agentId || "existing"}`);
      } else if (resp.status === 409) {
        knownPhones.add(phone);
      } else {
        api.logger?.warn?.(`[onboarding-hook] Webhook returned ${resp.status} for ${phone}`);
      }
    } catch (err) {
      api.logger?.error?.(`[onboarding-hook] Failed for ${phone}: ${err}`);
    }
  });
}
