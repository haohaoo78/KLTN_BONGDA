export type RefereeRoute = { page: "overview" | "assignments" | "assignment" | "operation" | "reports" | "report" | "notFound"; matchId?: string };
const id = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
export function parseRefereeRoute(path: string): RefereeRoute {
  if (/^\/referee\/?$/.test(path)) return { page: "overview" };
  if (/^\/referee\/assignments\/?$/.test(path)) return { page: "assignments" };
  if (/^\/referee\/reports\/?$/.test(path)) return { page: "reports" };
  for (const [pattern, page] of [[`^/referee/assignments/${id}/?$`, "assignment"], [`^/referee/matches/${id}/operation/?$`, "operation"], [`^/referee/reports/${id}/?$`, "report"]] as const) {
    const match = path.match(new RegExp(pattern, "i"));
    if (match) return { page, matchId: match[1] };
  }
  return { page: "notFound" };
}
export const refereePaths = {
  overview: "/referee", assignments: "/referee/assignments", reports: "/referee/reports",
  assignment: (matchId: string) => `/referee/assignments/${encodeURIComponent(matchId)}`,
  operation: (matchId: string) => `/referee/matches/${encodeURIComponent(matchId)}/operation`,
  report: (matchId: string) => `/referee/reports/${encodeURIComponent(matchId)}`,
};
