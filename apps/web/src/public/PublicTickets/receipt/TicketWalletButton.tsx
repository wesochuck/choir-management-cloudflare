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
        disabled={busy}
        onClick={() => void openWallet()}
        type="button"
      >
        {busy ? "Opening wallet…" : "Add to Wallet"}
      </button>
      {failed && (
        <p role="status">
          Wallet is currently unavailable. You can still use the QR code on this receipt.
        </p>
      )}
    </div>
  );
}
