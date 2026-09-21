# Use Connected Accounts and Direct Charges

Each Organization will onboard an Organization-owned Stripe connected account using **Stripe
Accounts v2**, and ticket, donation, dues, and bundle payments will be created as direct charges on
that account. The Organization is the merchant of record and bears its processing fees, refunds,
disputes, tax reporting, and negative-balance liability; free Platform Access never participates in
these transactions.

Under Stripe's Accounts v2 responsibility model:

- **Product intent:** The connected Organization bears its own payment, refund, and dispute
  economics; the platform is not the financial backstop.
- **API configuration:**
  - `dashboard = "full"`: Organizations receive the full Stripe Dashboard for complete visibility
    into their charges, payouts, disputes, and reporting.
  - `defaults.responsibilities.fees_collector = "stripe"`: Stripe collects processing fees directly
    from the connected Organization.
  - `defaults.responsibilities.losses_collector = "stripe"`: Stripe collects negative
    balances/losses directly from the connected Organization rather than charging them back to the
    platform.
  - `requirements_collector = "stripe"`: Stripe collects ongoing regulatory and identity
    verification requirements directly from the connected Organization.
- **Direct charges:** Direct charges created on the connected Organization
  (`Stripe-Account: acct_...`) remain the payment model for all customer purchases. No platform
  application fees or destination transfers are introduced.
- **Event destinations:** Account state changes are delivered via Stripe v2 Event Destinations (thin
  events such as `v2.core.account.updated`) and queried authoritatively via
  `GET /v2/core/accounts/:id` with merchant configuration includes.

**Why:** Customer purchases are transactions with the performing Organization, not with the software
platform. Direct charges send funds to the Organization and preserve its Stripe visibility and
responsibility, trading unified platform-level financial reporting and centralized liability for
correct merchant attribution, simpler fund custody, and isolation aligned with the Organization data
boundary.
