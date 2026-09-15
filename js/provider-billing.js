export const PROVIDER_BILLING_URLS = Object.freeze({
  openai: "https://platform.openai.com/settings/organization/billing/overview",
  minimax: "https://platform.minimax.io/console/recharge-records",
  byteplus: "https://console.byteplus.com/finance/overview",
  google: "https://aistudio.google.com/billing?billing=01FAA5-296897-6F043C&project=yueyuhoshizora",
});

export function providerBillingUrl(provider) {
  return PROVIDER_BILLING_URLS[provider] || "";
}
