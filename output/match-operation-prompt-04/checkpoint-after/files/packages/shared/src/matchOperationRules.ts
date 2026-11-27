/** Versioned competition rules. Null means undecided, never a permissive default. */
export type LawCode = "IFAB_2026_27" | "VFF_7_433_2023" | "FIFA_FUTSAL_2026_27" | "DECLARED_RULES";
export type RuleOperation = "LINEUP" | "CLOCK" | "SUBSTITUTION" | "SHOOTOUT" | "DISCIPLINE" | "FINALIZE";
export type RuleValue = string | number | boolean | null;
export type RuleField = { key: string; label: string; group: string; kind: "number" | "text" | "choice"; options?: readonly string[]; min?: number };

export const MATCH_RULE_FIELDS: readonly RuleField[] = [
  { key: "startingPlayers", label: "Số cầu thủ trên sân chuẩn", group: "Đội hình theo trận", kind: "number", min: 1 },
  { key: "minimumPlayers", label: "Tối thiểu để bắt đầu / tiếp tục", group: "Đội hình theo trận", kind: "number", min: 1 },
  { key: "maxSubstitutes", label: "Số cầu thủ dự bị tối đa trong trận", group: "Đội hình theo trận", kind: "number", min: 0 },
  { key: "goalkeepers", label: "Số thủ môn trên sân", group: "Đội hình theo trận", kind: "number", min: 1 },
  { key: "shirtNumbers", label: "Quy định số áo", group: "Đội hình theo trận", kind: "choice", options: ["UNIQUE", "UNIQUE_1_99"] },
  { key: "lineupSubmissionMinutes", label: "Nộp đội hình trước trận (phút, để trống nếu chưa quy định)", group: "Đội hình theo trận", kind: "number", min: 0 },
  { key: "lineupEditMinutes", label: "Dừng chỉnh đội hình trước trận (phút)", group: "Đội hình theo trận", kind: "number", min: 0 },
  { key: "lateLineupAuthority", label: "Thẩm quyền xử lý thay đổi sát giờ", group: "Đội hình theo trận", kind: "text" },
  { key: "periods", label: "Số hiệp chính", group: "Thời gian thi đấu", kind: "number", min: 1 },
  { key: "periodMinutes", label: "Thời lượng một hiệp (phút)", group: "Thời gian thi đấu", kind: "number", min: 1 },
  { key: "halfTimeMinutes", label: "Nghỉ giữa hiệp (phút)", group: "Thời gian thi đấu", kind: "number", min: 0 },
  { key: "clockMode", label: "Cơ chế đồng hồ", group: "Thời gian thi đấu", kind: "choice", options: ["CONTINUOUS", "STOPPED"] },
  { key: "addedTime", label: "Cơ chế bù giờ", group: "Thời gian thi đấu", kind: "choice", options: ["REFEREE_ALLOWANCE", "NO_ADDED_TIME"] },
  { key: "timeoutsPerPeriod", label: "Hội ý mỗi hiệp", group: "Thời gian thi đấu", kind: "number", min: 0 },
  { key: "timeoutSeconds", label: "Thời lượng hội ý (giây)", group: "Thời gian thi đấu", kind: "number", min: 0 },
  { key: "substitutionMode", label: "Cách thay người", group: "Thay người", kind: "choice", options: ["LIMITED", "ROLLING"] },
  { key: "maxSubstitutions", label: "Số cầu thủ được thay tối đa", group: "Thay người", kind: "number", min: 0 },
  { key: "substitutionOpportunities", label: "Cơ hội thay người trong thời gian thi đấu", group: "Thay người", kind: "number", min: 0 },
  { key: "returnSubstitutes", label: "Cầu thủ đã thay được trở lại", group: "Thay người", kind: "choice", options: ["YES", "NO"] },
  { key: "extraTimeSubstitutions", label: "Cầu thủ được thay thêm khi hiệp phụ", group: "Thay người", kind: "number", min: 0 },
  { key: "extraTimeOpportunities", label: "Cơ hội thay thêm khi hiệp phụ", group: "Thay người", kind: "number", min: 0 },
  { key: "redCardReduction", label: "Giảm người sau truất quyền thi đấu", group: "Kỷ luật", kind: "choice", options: ["REST_OF_MATCH", "FUTSAL_TWO_MINUTES", "DECLARED"] },
  { key: "disciplineScope", label: "Phạm vi thi hành treo giò", group: "Kỷ luật", kind: "choice", options: ["TOURNAMENT", "STAGE", "DECLARED"] },
  { key: "suspensionStarts", label: "Thời điểm bắt đầu thi hành", group: "Kỷ luật", kind: "text" },
  { key: "cardResetPolicy", label: "Chuyển tiếp / xóa thẻ giữa giai đoạn", group: "Kỷ luật", kind: "text" },
  { key: "directRedSuspensionMatches", label: "Treo giò do thẻ đỏ trực tiếp (trận)", group: "Kỷ luật", kind: "number", min: 0 },
  { key: "secondYellowSuspensionMatches", label: "Treo giò do thẻ vàng thứ hai (trận)", group: "Kỷ luật", kind: "number", min: 0 },
  { key: "groupDrawPolicy", label: "Xử lý hòa ở vòng bảng / vòng tròn", group: "Kết quả và khiếu nại", kind: "choice", options: ["ALLOW_DRAW", "PENALTIES_ONLY", "EXTRA_TIME_THEN_PENALTIES"] },
  { key: "shootoutKicks", label: "Số lượt luân lưu ban đầu mỗi đội", group: "Kết quả và khiếu nại", kind: "number", min: 1 },
  { key: "complaintAnchor", label: "Mốc tính thời hạn khiếu nại", group: "Kết quả và khiếu nại", kind: "choice", options: ["FINALIZED_AT", "PUBLISHED_AT", "DECLARED"] },
  { key: "appealPolicy", label: "Thẩm quyền, thủ tục kháng nghị", group: "Kết quả và khiếu nại", kind: "text" },
  { key: "lateArrivalPolicy", label: "Đội đến muộn / không đủ người", group: "Kết quả và khiếu nại", kind: "text" },
  { key: "fairPlayPolicy", label: "Trọng số fair-play nếu điều lệ sử dụng", group: "Kết quả và khiếu nại", kind: "text" },
] as const;

export const RULE_VALUE_LABELS: Record<string, string> = {
  UNIQUE: "Không trùng số áo trong đội", UNIQUE_1_99: "Không trùng, từ 1 đến 99", CONTINUOUS: "Chạy liên tục", STOPPED: "Thời gian thi đấu thực tế",
  REFEREE_ALLOWANCE: "Trọng tài quyết định bù giờ", NO_ADDED_TIME: "Không cộng bù giờ thông thường", LIMITED: "Giới hạn số cầu thủ", ROLLING: "Thay luân phiên",
  YES: "Có", NO: "Không", REST_OF_MATCH: "Giảm người hết trận", FUTSAL_TWO_MINUTES: "Giảm người theo Luật futsal (có điều kiện)", DECLARED: "Theo quy định được dẫn rõ",
  TOURNAMENT: "Trong giải", STAGE: "Trong giai đoạn", ALLOW_DRAW: "Cho phép hòa", PENALTIES_ONLY: "Luân lưu trực tiếp", EXTRA_TIME_THEN_PENALTIES: "Hiệp phụ rồi luân lưu",
  FINALIZED_AT: "Khi xác nhận kết quả cuối cùng", PUBLISHED_AT: "Khi công bố kết quả",
};

type LawProfile = { code: LawCode; label: string; footballFormat: 5 | 7 | 11 | null; sport: string; edition: string; source: string; fixed: Record<string, RuleValue>; maxBench?: number; maxHalfTime?: number; maxPeriod?: number };
export const MATCH_LAW_PROFILES: readonly LawProfile[] = [
  { code: "IFAB_2026_27", label: "Bóng đá 11 người · IFAB 2026/27", footballFormat: 11, sport: "ASSOCIATION_FOOTBALL", edition: "2026/27", source: "https://www.theifab.com/laws/latest/", maxBench: 15, maxHalfTime: 15, maxPeriod: 45,
    fixed: { startingPlayers: 11, minimumPlayers: 7, goalkeepers: 1, periods: 2, clockMode: "CONTINUOUS", addedTime: "REFEREE_ALLOWANCE", timeoutsPerPeriod: 0, timeoutSeconds: 0, redCardReduction: "REST_OF_MATCH", shootoutKicks: 5 } },
  { code: "VFF_7_433_2023", label: "Bóng đá 7 người · VFF 433/QĐ-LĐBĐVN (22/08/2023)", footballFormat: 7, sport: "SEVEN_A_SIDE", edition: "433/QD-LDBDVN 22/08/2023", source: "https://vff.org.vn/luat-van-ban/luat-thi-dau-bong-da-7-nguoi/", maxBench: 13, maxHalfTime: 10, maxPeriod: 35,
    fixed: { startingPlayers: 7, minimumPlayers: 4, goalkeepers: 1, periods: 2, clockMode: "CONTINUOUS", addedTime: "REFEREE_ALLOWANCE", timeoutsPerPeriod: 0, timeoutSeconds: 0, substitutionMode: "LIMITED", maxSubstitutions: 7, substitutionOpportunities: 4, returnSubstitutes: "NO", redCardReduction: "REST_OF_MATCH", shootoutKicks: 5 } },
  { code: "FIFA_FUTSAL_2026_27", label: "Futsal · FIFA 2026/27 (phải được điều lệ lựa chọn)", footballFormat: 5, sport: "FUTSAL", edition: "2026/27; effective 2026-10-22", source: "https://assets.dfb.de/uploads/000/341/436/original_Futsal_Laws_of_the_Game_2026-2027_EN.pdf", maxBench: 9, maxHalfTime: 15, maxPeriod: 20,
    fixed: { startingPlayers: 5, minimumPlayers: 3, goalkeepers: 1, periods: 2, clockMode: "STOPPED", addedTime: "NO_ADDED_TIME", timeoutsPerPeriod: 1, timeoutSeconds: 60, substitutionMode: "ROLLING", returnSubstitutes: "YES", redCardReduction: "FUTSAL_TWO_MINUTES", shootoutKicks: 5 } },
  { code: "DECLARED_RULES", label: "Bộ luật khác / sân 5 ngoài trời · cần dẫn căn cứ", footballFormat: null, sport: "DECLARED", edition: "", source: "", fixed: {} },
];

export type MatchOperationRules = { schemaVersion: 1; lawCode: LawCode | null; sport: string | null; edition: string | null; source: string | null; modifications: string | null; values: Record<string, RuleValue> };
export type OperationRuleVersion = { id: string; tournamentId: string; baseRegulationVersion: number; revision: number; status: "DRAFT" | "PUBLISHED"; rules: MatchOperationRules; reason: string; createdBy: string; createdAt: string; publishedBy: string | null; publishedAt: string | null; baseSnapshot?: MatchRulesBase | null };
export type MatchRulesBase = { regulationVersion: number | null; footballFormat: number | null; competitionFormat: string | null; rankingCriteria: string[]; rules: Record<string, unknown> | null; source?: "DRAW_SNAPSHOT" | "VERSIONED_SUPPLEMENT_BASE" | "MISSING_DRAW_SNAPSHOT" };
export type EffectiveMatchRules = { base: MatchRulesBase; supplement: OperationRuleVersion | null; bindingRevision: number; stage: "GROUP" | "KNOCKOUT" | null; rules: MatchOperationRules; decisionMethod: string | null; extraTimeMinutes: number | null; missing: Record<RuleOperation, string[]> };

export function emptyMatchOperationRules(): MatchOperationRules {
  return { schemaVersion: 1, lawCode: null, sport: null, edition: null, source: null, modifications: null, values: Object.fromEntries(MATCH_RULE_FIELDS.map(f => [f.key, null])) };
}
export function selectMatchLaw(code: LawCode | null, previous = emptyMatchOperationRules()): MatchOperationRules {
  const profile = MATCH_LAW_PROFILES.find(p => p.code === code);
  // Changing rulebook must not retain fixed rules from the previous one.
  return { ...emptyMatchOperationRules(), modifications: previous.modifications, lawCode: profile?.code ?? null, sport: profile?.sport ?? null,
    edition: profile?.edition || null, source: profile?.source || null, values: { ...emptyMatchOperationRules().values, ...profile?.fixed } };
}

export function validateMatchOperationRules(raw: unknown, footballFormat: number): { rules: MatchOperationRules; errors: string[] } {
  const errors: string[] = [], empty = emptyMatchOperationRules();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { rules: empty, errors: ["Cấu hình quy tắc phải là một đối tượng."] };
  const input = raw as Record<string, unknown>, profile = MATCH_LAW_PROFILES.find(p => p.code === input.lawCode);
  if (input.schemaVersion !== 1) errors.push("Phiên bản cấu trúc quy tắc không được hỗ trợ.");
  if (input.lawCode != null && !profile) errors.push("Bộ luật không được hỗ trợ.");
  if (profile?.footballFormat && profile.footballFormat !== footballFormat) errors.push("Bộ luật không phù hợp số cầu thủ trên sân của giải.");
  const rules = selectMatchLaw(profile?.code ?? null);
  for (const key of ["sport", "edition", "source", "modifications"] as const) {
    const value = input[key];
    if (value != null && (typeof value !== "string" || value.length > 4000)) errors.push(`Trường ${key} không hợp lệ.`);
    else if (key === "modifications" || profile?.code === "DECLARED_RULES") rules[key] = typeof value === "string" ? value.trim() || null : null;
    else if (value != null && value !== rules[key]) errors.push(`Không được thay đổi ${key} của bộ luật đã chọn.`);
  }
  if (rules.source && !/^https:\/\//i.test(rules.source)) errors.push("Nguồn căn cứ phải là địa chỉ HTTPS.");
  const values = input.values;
  if (!values || typeof values !== "object" || Array.isArray(values)) errors.push("Thiếu nhóm giá trị quy tắc.");
  else {
    const record = values as Record<string, unknown>;
    for (const key of Object.keys(record)) if (!MATCH_RULE_FIELDS.some(f => f.key === key)) errors.push(`Quy tắc không được hỗ trợ: ${key}.`);
    for (const field of MATCH_RULE_FIELDS) {
      const value = record[field.key];
      if (value == null || value === "") continue;
      if (field.kind === "number" && (!Number.isInteger(value) || (value as number) < (field.min ?? 0))) errors.push(`${field.label}: cần số nguyên từ ${field.min ?? 0}.`);
      else if (field.kind === "choice" && !field.options?.includes(String(value))) errors.push(`${field.label}: lựa chọn không hợp lệ.`);
      else if (field.kind === "text" && (typeof value !== "string" || value.length > 4000)) errors.push(`${field.label}: nội dung không hợp lệ.`);
      else if (profile?.fixed[field.key] != null && profile.fixed[field.key] !== value) errors.push(`${field.label}: phải tuân theo bộ luật đã chọn.`);
      else rules.values[field.key] = typeof value === "string" ? value.trim() || null : value as RuleValue;
    }
  }
  const v = rules.values;
  if (typeof v.startingPlayers === "number" && v.startingPlayers !== footballFormat) errors.push("Số cầu thủ trên sân phải khớp loại hình của giải.");
  if (typeof v.minimumPlayers === "number" && typeof v.startingPlayers === "number" && v.minimumPlayers > v.startingPlayers) errors.push("Số cầu thủ tối thiểu vượt quá số cầu thủ trên sân.");
  for (const [key, max] of [["maxSubstitutes", profile?.maxBench], ["halfTimeMinutes", profile?.maxHalfTime], ["periodMinutes", profile?.maxPeriod]] as const) {
    if (max != null && typeof v[key] === "number" && (v[key] as number) > max) errors.push(`${MATCH_RULE_FIELDS.find(f => f.key === key)!.label}: vượt giới hạn ${max} của bộ luật.`);
  }
  if (v.substitutionMode === "ROLLING" && (v.maxSubstitutions != null || v.substitutionOpportunities != null)) errors.push("Thay luân phiên không dùng giới hạn số lần/cơ hội thay người.");
  if (profile?.code === "IFAB_2026_27" && typeof v.maxSubstitutions === "number" && v.maxSubstitutions > 5) errors.push("IFAB: số cầu thủ được thay trong giải chính thức không vượt 5; ngoại lệ cần bộ căn cứ được khai báo riêng.");
  if (profile?.code === "IFAB_2026_27" && typeof v.maxSubstitutes === "number" && v.maxSubstitutes < 3) errors.push("IFAB Luật 3: giới hạn dự bị được điều lệ giải chính thức quy định từ 3 đến 15; không yêu cầu đội phải sử dụng đủ dự bị.");
  if (profile?.code === "IFAB_2026_27" && v.returnSubstitutes === "YES" && !rules.modifications) errors.push("Tái nhập sân theo IFAB cần ghi căn cứ cho phép của cơ quan có thẩm quyền.");
  // Existing match clock has two periods. Do not publish unsupported formats as operable.
  if (v.periods != null && v.periods !== 2) errors.push("Không gian tác nghiệp hiện chỉ hỗ trợ hai hiệp chính.");
  return { rules, errors };
}

export function resolveMatchOperationRules(base: MatchRulesBase, supplement: OperationRuleVersion | null, stage: EffectiveMatchRules["stage"], bindingRevision = 0): EffectiveMatchRules {
  const rules = supplement?.rules ?? emptyMatchOperationRules(), v = { ...rules.values };
  // Total match duration is already a published competition value, not a roster limit.
  const duration = base.rules?.matchDurationMinutes;
  if (v.periodMinutes == null && v.periods === 2 && typeof duration === "number" && duration > 0 && duration % 2 === 0) v.periodMinutes = duration / 2;
  const resolved = { ...rules, values: v };
  const group = stage === "GROUP" || base.competitionFormat === "ROUND_ROBIN";
  const decisionMethod = group ? (v.groupDrawPolicy as string | null) : stage === "KNOCKOUT" ? (typeof base.rules?.knockoutDecisionMethod === "string" ? base.rules.knockoutDecisionMethod : null) : null;
  const extraTimeMinutes = decisionMethod === "EXTRA_TIME_THEN_PENALTIES" && typeof base.rules?.extraTimeMinutes === "number" ? base.rules.extraTimeMinutes : decisionMethod ? 0 : null;
  const required: Record<RuleOperation, string[]> = {
    LINEUP: ["startingPlayers", "minimumPlayers", "maxSubstitutes", "goalkeepers", "shirtNumbers"],
    CLOCK: ["periods", "periodMinutes", "halfTimeMinutes", "clockMode", "addedTime"],
    SUBSTITUTION: ["substitutionMode", "returnSubstitutes", ...(v.substitutionMode === "LIMITED" ? ["maxSubstitutions", "substitutionOpportunities"] : [])],
    SHOOTOUT: ["shootoutKicks"], DISCIPLINE: ["redCardReduction", "disciplineScope", "suspensionStarts", "cardResetPolicy", "directRedSuspensionMatches", "secondYellowSuspensionMatches"], FINALIZE: [],
  };
  const missing = Object.fromEntries(Object.entries(required).map(([op, fields]) => [op, fields.filter(k => v[k] == null).map(k => MATCH_RULE_FIELDS.find(f => f.key === k)!.label)])) as Record<RuleOperation, string[]>;
  for (const op of Object.keys(missing) as RuleOperation[]) {
    if (!rules.lawCode || !rules.sport || !rules.edition || !rules.source) missing[op].unshift("Bộ luật, loại hình, phiên bản và nguồn căn cứ");
    if (base.regulationVersion == null) missing[op].unshift("Phiên bản điều lệ chính thức của trận");
  }
  if (!decisionMethod) { missing.FINALIZE.push("Phương thức xử lý hòa cho giai đoạn này"); missing.SHOOTOUT.push("Phương thức xử lý hòa cho giai đoạn này"); }
  if (decisionMethod === "EXTRA_TIME_THEN_PENALTIES" && (!extraTimeMinutes || extraTimeMinutes % 2 !== 0)) { missing.CLOCK.push("Thời lượng hai hiệp phụ hợp lệ trong điều lệ"); missing.FINALIZE.push("Thời lượng hai hiệp phụ hợp lệ trong điều lệ"); }
  const profile = MATCH_LAW_PROFILES.find(p => p.code === rules.lawCode);
  if (profile?.maxPeriod && typeof v.periodMinutes === "number" && v.periodMinutes > profile.maxPeriod) missing.CLOCK.push("Thời lượng điều lệ vượt giới hạn bộ luật đã chọn; cần điều chỉnh có thẩm quyền");
  if (decisionMethod === "EXTRA_TIME_THEN_PENALTIES" && rules.lawCode === "VFF_7_433_2023" && extraTimeMinutes !== 20) {
    missing.CLOCK.push("VFF 433: hai hiệp phụ 10 phút; điều lệ gốc chưa khớp"); missing.FINALIZE.push("VFF 433: thời lượng hiệp phụ chưa khớp");
  }
  if (decisionMethod === "EXTRA_TIME_THEN_PENALTIES" && rules.lawCode === "IFAB_2026_27" && extraTimeMinutes != null && extraTimeMinutes > 30) missing.CLOCK.push("Hiệp phụ vượt giới hạn IFAB");
  return { base, supplement, bindingRevision, stage, rules: resolved, decisionMethod, extraTimeMinutes, missing };
}
