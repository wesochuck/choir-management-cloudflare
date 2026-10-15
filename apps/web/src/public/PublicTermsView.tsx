import { useEffect } from "react";

export function PublicTermsView() {
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = "Terms of Service · MusicSite";
    }
  }, []);

  return (
    <div className="terms-layout">
      <nav aria-label="Breadcrumb" className="terms-nav">
        <a className="button button--secondary button--small" href="/">
          ← Return to MusicSite
        </a>
      </nav>

      <header className="terms-header">
        <h1>Terms of Service &amp; Messaging Terms</h1>
        <p className="terms-meta">
          <strong>MusicSite / Choir Management</strong> · Effective Date: October 15, 2026
        </p>
      </header>

      <article className="terms-content" aria-label="Terms of service body">
        <section aria-labelledby="terms-intro-title">
          <h2 id="terms-intro-title">1. Introduction &amp; Acceptance of Terms</h2>
          <p>
            Welcome to MusicSite (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;), also
            operating as Choir Management. These Terms of Service (&ldquo;Terms&rdquo;) govern your
            access to and use of our web platform, rehearsal scheduling, sheet music and practice
            audio players, member directories, ticketing, dues processing, and electronic
            communications services.
          </p>
          <p>
            By accessing or using our websites, signing into an ensemble workspace, purchasing
            tickets, or receiving communications through our platform, you agree to be bound by
            these Terms and our <a href="/privacy">Privacy Policy</a>. If you do not agree to these
            Terms, you must not access or use our services.
          </p>
        </section>

        <section aria-labelledby="terms-accounts-title">
          <h2 id="terms-accounts-title">2. Eligibility &amp; User Accounts</h2>
          <p>
            To access choir workspace features, you must be invited by an authorized choir director
            or administrator, or register through an authorized roster onboarding link. You are
            responsible for:
          </p>
          <ul>
            <li>Maintaining the confidentiality of your sign-in credentials.</li>
            <li>Providing accurate, current, and complete profile information.</li>
            <li>Promptly notifying your choir administrator of any unauthorized account access.</li>
          </ul>
        </section>

        <section aria-labelledby="terms-ip-title">
          <h2 id="terms-ip-title">3. Intellectual Property &amp; Repertoire Materials</h2>
          <p>
            MusicSite provides storage and playback tools for community choruses and musical
            ensembles. All copyrights, trademarks, sheet music, arrangement rights, audio
            recordings, and other creative materials uploaded by an organization remain the
            intellectual property of their respective owners or the ensemble.
          </p>
          <p>
            Access to practice recordings and sheet music is granted exclusively to authorized
            ensemble members solely for personal rehearsal and performance preparation. You may not
            publicly distribute, broadcast, commercially exploit, or share restricted ensemble
            materials outside your musical organization.
          </p>
        </section>

        <section aria-labelledby="terms-sms-title" className="terms-callout" id="messaging-terms">
          <h2 id="terms-sms-title">4. Messaging Terms &amp; Conditions (A2P 10DLC Disclosures)</h2>
          <p>
            MusicSite and Choir Management provide transactional mobile text messaging (SMS) to
            support timely, operational coordination for musical ensembles and their performers.
          </p>

          <h3>Service Description &amp; Scope</h3>
          <p>
            Text messages sent through our platform are strictly non-marketing and transactional.
            Message types include:
          </p>
          <ul>
            <li>Emergency rehearsal cancellations or weather delays.</li>
            <li>Time-critical call time or rehearsal venue updates.</li>
            <li>Upcoming performance call-time reminders for confirmed performers.</li>
          </ul>
          <p>
            <strong>
              We never send promotional, marketing, advertising, or fundraising messages via text
              messaging.
            </strong>
          </p>

          <h3>Opt-Out &amp; Assistance (STOP / HELP)</h3>
          <ul>
            <li>
              <strong>To Stop Receiving Messages:</strong> You may cancel text notifications at any
              time by replying <strong>STOP</strong> to any message you receive from us. Upon
              replying STOP, you will receive a single confirmation message verifying your opt-out,
              and no further text messages will be sent to your mobile number.
            </li>
            <li>
              <strong>For Customer Support:</strong> Reply <strong>HELP</strong> to any message, or
              contact our support team directly at{" "}
              <a href="mailto:support@musicsite.org">support@musicsite.org</a>.
            </li>
          </ul>

          <h3>Message Frequency &amp; Rates</h3>
          <p>
            Message frequency varies based on your choir&rsquo;s schedule, rehearsal calendar, and
            active performance periods, typically 1 to 4 messages per month. Message and data rates
            may apply according to your mobile carrier and rate plan.
          </p>

          <h3>Carrier Non-Liability</h3>
          <p>
            Wireless carriers (including but not limited to T-Mobile, AT&amp;T, and Verizon) are not
            liable for delayed or undelivered messages.
          </p>

          <h3>Privacy of Mobile Data</h3>
          <p>
            Your mobile phone number and SMS consent will not be sold, rented, or shared with third
            parties or affiliates for marketing or promotional purposes. For full details on our
            data protection practices, review our <a href="/privacy">Privacy Policy</a>.
          </p>
        </section>

        <section aria-labelledby="terms-commerce-title">
          <h2 id="terms-commerce-title">5. Ticketing, Dues, and Purchases</h2>
          <p>
            Ensembles may offer concert tickets, subscriptions, and member dues payments through our
            platform. Payment transactions are processed directly by our third-party payment partner
            (Stripe). Each musical organization independently determines its ticket prices, refund
            policies, and admission guidelines.
          </p>
          <p>
            Ticket confirmation QR codes and admission credentials issued through MusicSite are
            valid only for the designated event and venue. Unauthorized reproduction or resale is
            prohibited.
          </p>
        </section>

        <section aria-labelledby="terms-conduct-title">
          <h2 id="terms-conduct-title">6. Acceptable Use &amp; Code of Conduct</h2>
          <p>When using our platform, you agree not to:</p>
          <ul>
            <li>Interfere with, disrupt, or compromise server or edge security.</li>
            <li>Attempt to access data or workspaces belonging to another organization.</li>
            <li>Transmit harmful code, malware, or automated scraping requests.</li>
            <li>
              Use communications channels to transmit abusive, defamatory, or unlawful content.
            </li>
          </ul>
        </section>

        <section aria-labelledby="terms-disclaimer-title">
          <h2 id="terms-disclaimer-title">7. Service Availability &amp; Disclaimers</h2>
          <p>
            Our services are provided on an &ldquo;AS IS&rdquo; and &ldquo;AS AVAILABLE&rdquo;
            basis. While we strive for maximum uptime and reliability, we do not warrant that
            platform availability will be uninterrupted, error-free, or free from scheduled
            maintenance downtime.
          </p>
        </section>

        <section aria-labelledby="terms-liability-title">
          <h2 id="terms-liability-title">8. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by applicable law, MusicSite and its operators shall not
            be liable for any indirect, incidental, consequential, special, or punitive damages
            arising from your use of or inability to use the platform, including lost data, missed
            rehearsals, or third-party carrier delays.
          </p>
        </section>

        <section aria-labelledby="terms-contact-title">
          <h2 id="terms-contact-title">9. Contact &amp; Legal Notices</h2>
          <p>For questions, legal inquiries, or support regarding these Terms, please contact:</p>
          <p>
            <strong>MusicSite / Choir Management</strong>
            <br />
            Email: <a href="mailto:support@musicsite.org">support@musicsite.org</a>
            <br />
            Website: <a href="https://musicsite.org">https://musicsite.org</a>
          </p>
        </section>
      </article>

      <footer className="terms-footer">
        <p>© {new Date().getUTCFullYear()} MusicSite / Choir Management. All rights reserved.</p>
        <p>
          <a href="/">Platform Home</a> · <a href="/privacy">Privacy Policy</a> ·{" "}
          <a href="mailto:support@musicsite.org">Contact Support</a>
        </p>
      </footer>
    </div>
  );
}
