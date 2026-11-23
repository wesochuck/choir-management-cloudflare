import { useState } from "react";
import { getTicketWalletPass } from "../../../api/ticketing";

export function TicketWalletButton({ token }: { readonly token: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function openWallet() {
    setBusy(true);
    setFailed(false);
    try {
      window.location.assign(await getTicketWalletPass(token));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="no-print">
      <button
        className="button button--secondary"
        aria-describedby="ticket-wallet-help"
        disabled={busy}
        onClick={() => void openWallet()}
        type="button"
      >
        {busy ? "Opening wallet…" : "Add to Wallet"}
      </button>
      <p className="field-help" id="ticket-wallet-help">
        WalletWallet opens so you can save your ticket to Apple Wallet or Google Wallet. Look for
        the concert or bundle title in your wallet.
      </p>
      {failed && (
        <p role="status">
          Wallet is currently unavailable. You can still use the QR code on this receipt.
        </p>
      )}
    </div>
  );
}
