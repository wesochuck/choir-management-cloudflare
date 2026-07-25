const reportTypes = [
  { description: "RSVP summary for a selected event.", title: "RSVP Report" },
  { description: "Attendance records for a selected event.", title: "Attendance Report" },
  { description: "Full roster listing.", title: "Roster Export" },
  { description: "Donation history.", title: "Donation Report" },
] as const;

export function ReportsView() {
  return (
    <main className="account-layout">
      <div className="account-heading">
        <p className="eyebrow">Reports</p>
        <h1>Reports</h1>
      </div>
      <div className="module-grid">
        {reportTypes.map((report) => (
          <article className="module-card" key={report.title}>
            <h3>{report.title}</h3>
            <p>{report.description}</p>
          </article>
        ))}
      </div>
    </main>
  );
}
