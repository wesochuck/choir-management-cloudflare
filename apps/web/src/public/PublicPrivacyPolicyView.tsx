import { useEffect } from "react";

export function PublicPrivacyPolicyView() {
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = "Privacy Policy · MusicSite";
    }
  }, []);

  return (
    <div className="privacy-policy-layout">
      <nav aria-label="Breadcrumb" className="privacy-policy-nav">
        <a className="button button--secondary button--small" href="/">
          ← Return to MusicSite
        </a>
      </nav>

      <header className="privacy-policy-header">
        <h1>Privacy Policy</h1>
        <p className="privacy-policy-meta">
          <strong>MusicSite / Choir Management</strong> · Effective Date: October 15, 2026
        </p>
      </header>

      <article className="privacy-policy-content" aria-label="Privacy policy body">
        <section aria-labelledby="privacy-intro-title">
          <h2 id="privacy-intro-title">1. Introduction &amp; Scope</h2>
          <p>
            MusicSite (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;), also operating as
            Choir Management, provides rehearsal scheduling, music libraries, practice audio
            players, member rosters, communications, concert ticketing, and dues services for
            community choruses, choirs, and musical ensembles.
          </p>
          <p>
            This Privacy Policy explains how we collect, use, protect, and handle your information
            when you visit our websites, use our member workspaces, access shared practice links, or
            receive electronic notifications from your musical organization through our platform.
          </p>
        </section>

        <section aria-labelledby="privacy-collection-title">
          <h2 id="privacy-collection-title">2. Information We Collect</h2>
          <p>We collect information in the following circumstances:</p>
          <ul>
            <li>
              <strong>Ensemble Members &amp; Performers:</strong> When your choir registers you or
              when you complete your profile, we collect your name, email address, voice part,
              section assignment, and voluntary mobile phone number. We also record your rehearsal
              and performance RSVP commitments and attendance records.
            </li>
            <li>
              <strong>Ticket Purchasers &amp; Donors:</strong> When you purchase tickets or donate
              to a choir through the platform, we collect your name, email address, transaction
              history, and ticket details. Payment card data is processed directly by our
              third-party payment processor (Stripe); we never receive or store your full credit or
              debit card numbers on our servers.
            </li>
            <li>
              <strong>Platform Inquiries:</strong> If you contact us about bringing Choir Management
              to your choir, we collect your name, choir name, contact email, and approximate singer
              count.
            </li>
            <li>
              <strong>Technical &amp; Log Data:</strong> Like most web applications, our servers and
              edge infrastructure automatically record diagnostic data, including IP addresses,
              browser type, operating system, referring pages, and access timestamps, solely for
              security, fraud prevention, and platform reliability.
            </li>
          </ul>
        </section>

        <section aria-labelledby="privacy-usage-title">
          <h2 id="privacy-usage-title">3. How We Use Your Information</h2>
          <p>We use the information we collect strictly to deliver ensemble services, including:</p>
          <ul>
            <li>Publishing rehearsal and concert schedules to authorized choir members.</li>
            <li>
              Delivering operational notifications, schedule changes, and reminders on behalf of
              choir directors and administrators.
            </li>
            <li>
              Providing part-specific practice audio tracks and sheet music to authorized singers.
            </li>
            <li>Fulfilling concert ticket purchases and delivering digital admission codes.</li>
            <li>Ensuring tenant isolation, account security, and preventing abuse.</li>
          </ul>
        </section>

        <section
          aria-labelledby="privacy-sms-title"
          className="privacy-policy-callout"
          id="sms-policy"
        >
          <h2 id="privacy-sms-title">
            4. Non-Marketing SMS &amp; Mobile Communications (A2P 10DLC Disclosures)
          </h2>
          <p>
            MusicSite and Choir Management support transactional text messaging (SMS) strictly for
            urgent, time-sensitive operational alerts on behalf of musical organizations.
          </p>

          <h3>Strict Non-Marketing Scope</h3>
          <p>
            Text messages sent through our platform are exclusively non-marketing and transactional.
            Permitted text messages include:
          </p>
          <ul>
            <li>Emergency rehearsal cancellations or weather delays.</li>
            <li>Time-critical call time or venue changes.</li>
            <li>Approaching performance call-time alerts for confirmed performers.</li>
          </ul>
          <p>
            <strong>
              We never send promotional, marketing, advertising, or fundraising messages via text
              messaging.
            </strong>
          </p>

          <h3>No Sharing of Mobile Data</h3>
          <p>
            <strong>
              No mobile information will be shared with third parties or affiliates for marketing or
              promotional purposes. All the above categories exclude text messaging originator
              opt-in data and consent; this information will not be shared with any third parties.
            </strong>
          </p>
          <p>
            We share phone numbers only with technical communications providers (such as telephony
            gateways) under strict contractual agreements requiring them to process the data solely
            to transmit the requested message on our behalf.
          </p>

          <h3>Voluntary Consent &amp; Opt-In</h3>
          <p>
            Mobile numbers are collected only when a member voluntarily provides their number in
            their member profile or during enrollment, with explicit notice that the number will be
            used for urgent choir announcements. We never obtain phone numbers through third-party
            lead lists, data brokers, web scraping, or automatic opt-in.
          </p>

          <h3>Opt-Out &amp; Assistance (STOP / HELP)</h3>
          <ul>
            <li>
              <strong>To Stop Receiving Messages:</strong> You may opt out of SMS messages at any
              time by replying <strong>STOP</strong> to any text message you receive from us. You
              will receive a one-time confirmation of your unsubscribe request, and no further text
              messages will be sent to your number.
            </li>
            <li>
              <strong>For Help or Support:</strong> Reply <strong>HELP</strong> to any text message,
              or email our support team directly at{" "}
              <a href="mailto:support@musicsite.org">support@musicsite.org</a>.
            </li>
          </ul>

          <h3>Message Frequency &amp; Rates</h3>
          <p>
            Message frequency varies based on your choir&rsquo;s schedule and seasonal events,
            typically 1 to 4 messages per month during active concert periods. Message and data
            rates may apply depending on your mobile carrier and plan.
          </p>

          <h3>Carrier Non-Liability</h3>
          <p>
            Wireless carriers (including but not limited to T-Mobile, AT&amp;T, and Verizon) are not
            liable for delayed or undelivered messages.
          </p>
        </section>

        <section aria-labelledby="privacy-sharing-title">
          <h2 id="privacy-sharing-title">5. Information Sharing &amp; Disclosure</h2>
          <p>
            We do not sell, rent, monetize, or trade personal data. Information is shared only as
            described below:
          </p>
          <ul>
            <li>
              <strong>Your Musical Organization:</strong> Authorized administrators and directors of
              your choir can view roster details, section assignments, and attendance responses for
              performers in their ensemble. Data is strictly isolated by Organization; no other
              choir can view or access your information.
            </li>
            <li>
              <strong>Service Providers:</strong> We work with trusted technology providers who host
              our servers, deliver emails, transmit SMS, and process payments (such as Cloudflare,
              Brevo, Twilio, and Stripe). These providers are contractually bound to confidentiality
              and may only process data to fulfill requested services.
            </li>
            <li>
              <strong>Legal Compliance:</strong> We may disclose information if required to comply
              with a valid legal order, court process, or applicable regulation, or to protect the
              vital safety and rights of users.
            </li>
          </ul>
        </section>

        <section aria-labelledby="privacy-security-title">
          <h2 id="privacy-security-title">6. Data Security &amp; Retention</h2>
          <p>
            We implement technical and organizational safeguards to protect your data, including
            HTTPS encryption in transit, per-tenant data partitioning, and scoped access controls.
          </p>
          <p>
            We retain personal data for as long as your ensemble maintains an active account on the
            platform or as needed to provide services, satisfy accounting/tax requirements for
            ticket sales, or comply with legal obligations.
          </p>
        </section>

        <section aria-labelledby="privacy-rights-title">
          <h2 id="privacy-rights-title">7. Your Rights &amp; Choices</h2>
          <p>
            You have the right to access, update, or correct your personal profile information at
            any time by signing into your member account. You may also contact your choir
            administrator to request updates or deletion of your roster record.
          </p>
          <p>
            To manage email communications, you may use the unsubscribe links included in
            non-critical emails or adjust reminder preferences within your account workspace. For
            SMS messages, replying STOP immediately halts text notifications.
          </p>
        </section>

        <section aria-labelledby="privacy-contact-title">
          <h2 id="privacy-contact-title">8. Contact Us</h2>
          <p>
            If you have questions, comments, or privacy concerns regarding this policy, please
            contact our privacy and support team:
          </p>
          <p>
            <strong>MusicSite / Choir Management</strong>
            <br />
            Email: <a href="mailto:support@musicsite.org">support@musicsite.org</a>
            <br />
            Website: <a href="https://musicsite.org">https://musicsite.org</a>
          </p>
        </section>
      </article>

      <footer className="privacy-policy-footer">
        <p>© {new Date().getUTCFullYear()} MusicSite / Choir Management. All rights reserved.</p>
        <p>
          <a href="/">Platform Home</a> · <a href="mailto:support@musicsite.org">Contact Support</a>
        </p>
      </footer>
    </div>
  );
}
