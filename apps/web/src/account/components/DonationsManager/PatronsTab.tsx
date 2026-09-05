import { money, type PatronState } from "./types";

export function PatronsTab({ patronState }: { readonly patronState: PatronState }) {
  if (patronState.status === "loading") return <p>Loading patrons…</p>;
  if (patronState.status === "error")
    return <p className="notice notice--error">Patrons could not be loaded.</p>;
  if (patronState.patrons.length === 0) {
    return (
      <div className="empty-state">
        <p>No patrons recorded yet.</p>
      </div>
    );
  }
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Total Donated</th>
            <th>Donations</th>
            <th>First</th>
            <th>Latest</th>
          </tr>
        </thead>
        <tbody>
          {patronState.patrons.map((patron) => (
            <tr key={patron.id}>
              <td>{patron.name}</td>
              <td>{patron.email}</td>
              <td>{money(patron.totalDonatedCents)}</td>
              <td>{patron.donationCount}</td>
              <td>{new Date(patron.firstDonatedAt).toLocaleDateString()}</td>
              <td>{new Date(patron.lastDonatedAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
