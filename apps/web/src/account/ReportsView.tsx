const reportTypes = [
  { description: "RSVP summary for a selected event.", title: "RSVP Report" },
  { description: "Attendance records for a selected event.", title: "Attendance Report" },
  { description: "Full roster listing.", title: "Roster Export" },
  { description: "Donation history.", title: "Donation Report" },
] as const;

export function ReportsView() {
  return (
    <section className="module-grid" aria-label="Available reports">
      {reportTypes.map((report) => (
        <article className="module-card" key={report.title}>
          <h3>{report.title}</h3>
          <p>{report.description}</p>
        </article>
      ))}
    </section>
  );
}
