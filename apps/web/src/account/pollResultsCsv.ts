import type { OrganizationPollResultsResponse } from "@choir/contracts";
import { getLastName } from "@choir/domain";

/**
 * Pure builder for the poll-results CSV rows, extracted for unit testing.
 * Keeps CSV shaping out of the React component.
 */
export function buildPollResultsCsvRows(results: OrganizationPollResultsResponse): string[][] {
  const rows: string[][] = [
    [
      "Poll Title",
      "Option",
      "Votes",
      "Percentage",
      "Respondent Name",
      "Last Name",
      "Voice Part",
      "Responded At",
    ],
  ];
  for (const opt of results.options) {
    if (opt.respondents.length === 0) {
      rows.push([
        results.title,
        opt.label,
        String(opt.count),
        `${String(opt.percentage)}%`,
        "",
        "",
        "",
        "",
      ]);
    } else {
      for (const resp of opt.respondents) {
        rows.push([
          results.title,
          opt.label,
          String(opt.count),
          `${String(opt.percentage)}%`,
          resp.profileName,
          getLastName(resp.profileName),
          resp.voicePart,
          resp.respondedAt,
        ]);
      }
    }
  }
  return rows;
}
