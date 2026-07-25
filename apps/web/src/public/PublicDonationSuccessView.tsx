export function PublicDonationSuccessView() {
  return (
    <section className="public-section public-section--narrow">
      <p className="eyebrow">Donation complete</p>
      <h1>Thank you for your gift!</h1>
      <p>Your donation has been received. A receipt will be sent to your email.</p>
      <div className="panel">
        <p>
          Your generous support makes our music possible. If you have any questions about your
          donation, please contact us.
        </p>
      </div>
      <a className="button button--secondary" href="/">
        Return home
      </a>
    </section>
  );
}
