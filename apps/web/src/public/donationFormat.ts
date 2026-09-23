const donationCurrencyFormatter = new Intl.NumberFormat(undefined, {
  currency: "USD",
  style: "currency",
});

export function formatDonationMoney(cents: number, locale?: string): string {
  const formatter =
    locale === undefined
      ? donationCurrencyFormatter
      : new Intl.NumberFormat(locale, { currency: "USD", style: "currency" });
  return formatter.format(cents / 100);
}
