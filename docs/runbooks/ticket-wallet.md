# Ticket wallet passes

Configure the optional `WALLETWALLET_API_KEY` Worker secret through the staging secret-management
flow using a dedicated WalletWallet Free account. Deploy the qualified version through the staging
deployment runbook. Local and fake-effects environments suppress issuance. Removing the binding
disables new receipt wallet actions.

On a paid receipt, **Add to Wallet** creates a shared Apple/Google install link on the first
request. The Organization store saves that link under the purchase ID. One group or bundle order
consumes one creation. The pass captures public event details (up to 2,048 characters per
performance), venue, doors-open time and schedule at issuance. The door scanner uses the original
admission credential and checks the current payment state on every scan.

For a staging acceptance check, use a dedicated test purchase. Open the same receipt twice, confirm
the same install page on both visits, install on Apple and Google devices, and scan at the intended
performance. Check the Organization name, quantity, local time and public instructions on each
device. Treat install links and admission barcodes as bearer credentials.

A definite provider rejection allows another attempt after one minute. For a quota rejection, check
the account's monthly usage before retrying. A timeout or interrupted response can leave the
provider outcome unknown. WalletWallet assigns the serial at creation. The Organization store
retains the claim to prevent a second creation. The patron can still present or print the receipt
QR. Any operator recovery must reconcile the specific Organization and purchase with the provider
before restoring a verified link or releasing the claim. Keep keys, links and codes out of logs and
support messages.
