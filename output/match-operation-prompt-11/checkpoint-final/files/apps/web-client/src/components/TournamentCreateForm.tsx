import { useState, type FormEvent } from "react";
import type { TournamentCompetitionConfig, TournamentCreateInput } from "../api/competition";
import type { Institution } from "../api/institutions";

type Props = {
  institutions: Institution[];
  userInstitutionId: string | null;
  isAdmin: boolean;
  disabled: boolean;
  onSubmit: (input: TournamentCreateInput) => Promise<void>;
  onClose: () => void;
};

const rankingOptions: Array<{
  value: NonNullable<TournamentCreateInput["rankingCriteria"]>[number];
  label: string;
}> = [
  { value: "POINTS", label: "Điểm số (bắt buộc, ưu tiên đầu tiên)" },
  { value: "GOAL_DIFFERENCE", label: "Hiệu số bàn thắng" },
  { value: "GOALS_FOR", label: "Số bàn thắng" },
  { value: "HEAD_TO_HEAD", label: "Đối đầu trực tiếp" },
  { value: "FAIR_PLAY", label: "Điểm fair-play" },
  { value: "LOT_DRAW", label: "Bốc thăm" },
];

function estimateSchedule(input: {
  format: TournamentCreateInput["competitionFormat"];
  teams: number;
  legs: 1 | 2;
  groupCapacity: number;
  advancing: number;
  matchMinutes: number;
  extraTimeMinutes: number;
  restMinutes: number;
  pitches: number;
  hoursPerDay: number;
  startDate: string;
  endDate: string;
  config: TournamentCompetitionConfig;
}) {
  const { format, teams, legs, groupCapacity, advancing, matchMinutes, extraTimeMinutes, restMinutes, pitches, hoursPerDay, startDate, endDate, config } = input;
  const groupCount = format === "GROUP_AND_KNOCKOUT"
    ? config.groupCountMode === "FIXED" ? Math.max(1, config.groupCount ?? 1) : Math.ceil(teams / groupCapacity)
    : 1;
  const baseSize = Math.floor(teams / groupCount);
  const remainder = teams % groupCount;
  const groupSizes = Array.from({ length: groupCount }, (_, index) => baseSize + (index < remainder ? 1 : 0));
  const invalidGroupCapacity = format === "GROUP_AND_KNOCKOUT" && (groupSizes.some((size) => size < 2 || size > groupCapacity) || groupCount > teams / 2);
  const invalidAdvancement = format === "GROUP_AND_KNOCKOUT" && (groupSizes.some((size) => advancing > size) || advancing * groupCount < 2 || invalidGroupCapacity);
  const groupMatches = format === "KNOCKOUT" ? 0 : groupSizes.reduce((sum, size) => sum + (size * (size - 1)) / 2, 0) * legs;
  const playoffTeams = format === "KNOCKOUT" ? teams : format === "GROUP_AND_KNOCKOUT" ? groupCount * advancing : 0;
  const knockoutPairCount = format === "ROUND_ROBIN" ? 0 : Math.max(0, playoffTeams - 1);
  const playoffMatches = (knockoutPairCount + (config.thirdPlaceMatch && playoffTeams >= 3 ? 1 : 0)) * (format === "ROUND_ROBIN" ? 1 : config.knockoutLegs);
  const totalMatches = groupMatches + playoffMatches;
  const groupSlotsPerPitch = Math.max(1, Math.floor((hoursPerDay * 60 + restMinutes) / (matchMinutes + restMinutes)));
  const groupCapacityPerDay = groupSlotsPerPitch * pitches;
  const playoffDuration = matchMinutes + (format === "ROUND_ROBIN" ? 0 : extraTimeMinutes);
  const playoffCapacityPerDay = Math.max(1, Math.floor((hoursPerDay * 60 + restMinutes) / (playoffDuration + restMinutes)) * pitches);
  const maxGroupRounds = format === "KNOCKOUT" ? 0 : Math.max(0, ...groupSizes.map((size) => (size % 2 === 0 ? size - 1 : size) * legs));
  const roundsPerDay = Math.max(1, Math.floor((hoursPerDay * 60 + restMinutes) / (matchMinutes + restMinutes)));
  const playoffRoundsPerDay = Math.max(1, Math.floor((hoursPerDay * 60 + restMinutes) / (playoffDuration + restMinutes)));
  const groupDays = Math.max(Math.ceil(groupMatches / groupCapacityPerDay), Math.ceil(maxGroupRounds / roundsPerDay));
  const playoffRounds = playoffTeams > 1 ? Math.ceil(Math.log2(playoffTeams)) : 0;
  const playoffRoundDays = playoffRounds === 0 ? 0 : Math.ceil(playoffRounds / playoffRoundsPerDay);
  const playoffDays = Math.max(playoffRoundDays, Math.ceil(playoffMatches / playoffCapacityPerDay));
  const estimatedDays = groupDays + playoffDays;
  const availableDays = startDate && endDate
    ? Math.floor((new Date(`${endDate}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime()) / 86_400_000) + 1
    : 0;
  const groupRounds = format === "KNOCKOUT" ? 0 : Math.max(0, ...groupSizes.map((size) => (size % 2 === 0 ? size - 1 : size) * legs));
  const knockoutRounds = format === "ROUND_ROBIN" || playoffTeams < 2 ? 0 : Math.ceil(Math.log2(playoffTeams));
  const invalidSchedulingWindow = config.schedulingStartTime >= config.schedulingEndTime;
  return { groupCount, groupRounds, knockoutRounds, groupMatches, playoffMatches, totalMatches, estimatedDays, availableDays, invalidAdvancement, invalidGroupCapacity, invalidSchedulingWindow };
}

const defaultCompetitionConfig: TournamentCompetitionConfig = {
  groupCountMode: "AUTO_BY_CAPACITY", groupCount: null, groupAllocation: "BALANCED",
  sameInstitutionPolicy: "NONE", knockoutPairing: "GROUP_RANK",
  fixedPairingRule: "STANDARD_CROSSOVER", knockoutLegs: 1, thirdPlaceMatch: false,
  byePolicy: "AUTOMATIC", schedulingStartTime: "08:00", schedulingEndTime: "22:00",
};

export function TournamentCreateForm({
  institutions,
  userInstitutionId,
  isAdmin,
  disabled,
  onSubmit,
  onClose,
}: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [organizerName, setOrganizerName] = useState("");
  const [organizerContactName, setOrganizerContactName] = useState("");
  const [organizerEmail, setOrganizerEmail] = useState("");
  const [organizerPhone, setOrganizerPhone] = useState("");
  const [scope, setScope] = useState<TournamentCreateInput["scope"]>(
    isAdmin ? "INTER_SCHOOL" : "SINGLE_INSTITUTION",
  );
  const [allowedInstitutionIds, setAllowedInstitutionIds] = useState<string[]>(
    userInstitutionId ? [userInstitutionId] : [],
  );
  const [allowedInstitutionLevels, setAllowedInstitutionLevels] = useState<
    TournamentCreateInput["allowedInstitutionLevels"]
  >(["UNIVERSITY", "COLLEGE"]);
  const [allInstitutionsAllowed, setAllInstitutionsAllowed] = useState(false);
  const [defaultSchoolLimit, setDefaultSchoolLimit] = useState("");
  const [institutionLimitOverrides, setInstitutionLimitOverrides] = useState<Record<string, string>>({});
  const [institutionSearch, setInstitutionSearch] = useState("");
  const [footballFormat, setFootballFormat] = useState<TournamentCreateInput["footballFormat"]>(7);
  const [competitionFormat, setCompetitionFormat] =
    useState<TournamentCreateInput["competitionFormat"]>("GROUP_AND_KNOCKOUT");
  const [competitionConfig, setCompetitionConfig] = useState<TournamentCompetitionConfig>(defaultCompetitionConfig);
  const [roundRobinLegs, setRoundRobinLegs] = useState<1 | 2>(1);
  const [maxTeamsPerGroup, setMaxTeamsPerGroup] = useState(4);
  const [knockoutDecisionMethod, setKnockoutDecisionMethod] = useState<TournamentCreateInput["knockoutDecisionMethod"]>("PENALTIES_ONLY");
  const [extraTimeMinutes, setExtraTimeMinutes] = useState(30);
  const [minTeams, setMinTeams] = useState(2);
  const [maxTeams, setMaxTeams] = useState(16);
  const [minPlayers, setMinPlayers] = useState(7);
  const [maxPlayersPerTeam, setMaxPlayersPerTeam] = useState(25);
  const [minGoalkeepers, setMinGoalkeepers] = useState(1);
  const [registrationStart, setRegistrationStart] = useState("");
  const [registrationEnd, setRegistrationEnd] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [eligibilityDescription, setEligibilityDescription] = useState("");
  const [pointsForWin, setPointsForWin] = useState(3);
  const [pointsForDraw, setPointsForDraw] = useState(1);
  const [pointsForLoss, setPointsForLoss] = useState(0);
  const [rankingCriteria, setRankingCriteria] =
    useState<TournamentCreateInput["rankingCriteria"]>(["POINTS", "GOAL_DIFFERENCE", "GOALS_FOR"]);
  const [advancingTeamsPerGroup, setAdvancingTeamsPerGroup] = useState(2);
  const [yellowCardsForSuspension, setYellowCardsForSuspension] = useState(3);
  const [suspensionMatches, setSuspensionMatches] = useState(1);
  const [complaintWindowHours, setComplaintWindowHours] = useState(24);
  const [minimumRestMinutes, setMinimumRestMinutes] = useState(30);
  const [matchDurationMinutes, setMatchDurationMinutes] = useState(90);
  const [plannedPitchCount, setPlannedPitchCount] = useState(1);
  const [playableHoursPerDay, setPlayableHoursPerDay] = useState(8);
  const [forfeitPolicy, setForfeitPolicy] =
    useState<TournamentCreateInput["forfeitPolicy"]>("ORGANIZER_DECISION");
  const [forfeitWinnerScore, setForfeitWinnerScore] = useState(3);
  const [forfeitLoserScore, setForfeitLoserScore] = useState(0);
  const levelInstitutions = institutions.filter((institution) =>
    allowedInstitutionLevels.includes(institution.institutionType as "UNIVERSITY" | "COLLEGE") &&
    (scope !== "SINGLE_INSTITUTION" || institution.id === userInstitutionId),
  );
  const visibleInstitutions = levelInstitutions.filter((institution) =>
    institution.name.toLocaleLowerCase("vi").includes(institutionSearch.trim().toLocaleLowerCase("vi")),
  );
  const limitInstitutions = levelInstitutions.filter((institution) =>
    allInstitutionsAllowed || allowedInstitutionIds.includes(institution.id),
  );
  const normalizedAllowedInstitutionIds = scope === "SINGLE_INSTITUTION"
    ? allowedInstitutionIds
    : allInstitutionsAllowed ? [] : allowedInstitutionIds;
  const scheduleEstimate = estimateSchedule({
    format: competitionFormat,
    teams: maxTeams,
    legs: roundRobinLegs,
    groupCapacity: Math.max(2, maxTeamsPerGroup),
    advancing: advancingTeamsPerGroup,
    matchMinutes: matchDurationMinutes,
    extraTimeMinutes: knockoutDecisionMethod === "EXTRA_TIME_THEN_PENALTIES" ? extraTimeMinutes : 0,
    restMinutes: minimumRestMinutes,
    pitches: plannedPitchCount,
    hoursPerDay: playableHoursPerDay,
    startDate,
    endDate,
    config: competitionConfig,
  });

  function toggleInstitution(id: string) {
    if (scope === "SINGLE_INSTITUTION") return;
    if (allInstitutionsAllowed) {
      setAllowedInstitutionIds(levelInstitutions.map((institution) => institution.id).filter((item) => item !== id));
      setAllInstitutionsAllowed(false);
      return;
    }
    setAllowedInstitutionIds((selected) =>
      selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id],
    );
  }

  function toggleInstitutionLevel(level: "UNIVERSITY" | "COLLEGE") {
    setAllowedInstitutionLevels((current) => {
      const next = current.includes(level)
        ? current.filter((item) => item !== level)
        : [...current, level];
      if (next.length === 0) return current;
      const allowedIds = new Set(
        institutions
          .filter((institution) => next.includes(institution.institutionType as "UNIVERSITY" | "COLLEGE"))
          .map((institution) => institution.id),
      );
      setAllowedInstitutionIds((selected) => selected.filter((id) => allowedIds.has(id)));
      setInstitutionLimitOverrides((currentOverrides) =>
        Object.fromEntries(Object.entries(currentOverrides).filter(([id]) => allowedIds.has(id))),
      );
      return next;
    });
  }

  function toggleRankingCriterion(
    criterion: NonNullable<TournamentCreateInput["rankingCriteria"]>[number],
  ) {
    if (criterion === "POINTS") return;
    setRankingCriteria((selected) =>
      selected.includes(criterion)
        ? selected.filter((item) => item !== criterion)
        : [...selected, criterion],
    );
  }

  function moveRankingCriterion(
    criterion: NonNullable<TournamentCreateInput["rankingCriteria"]>[number],
    offset: number,
  ) {
    setRankingCriteria((selected) => {
      const currentIndex = selected.indexOf(criterion);
      const nextIndex = currentIndex + offset;
      if (currentIndex <= 0 || nextIndex <= 0 || nextIndex >= selected.length) return selected;
      const reordered = [...selected];
      [reordered[currentIndex], reordered[nextIndex]] = [reordered[nextIndex], reordered[currentIndex]];
      return reordered;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (scope === "SINGLE_INSTITUTION" && allowedInstitutionIds.length !== 1) return;
    if (allowedInstitutionLevels.length === 0) return;
    if (scope === "INTER_SCHOOL" && !allInstitutionsAllowed && allowedInstitutionIds.length === 0) return;
    if (
      !isAdmin &&
      (!userInstitutionId ||
        (!allInstitutionsAllowed && !allowedInstitutionIds.includes(userInstitutionId)) ||
        !allowedInstitutionLevels.includes(
          institutions.find((institution) => institution.id === userInstitutionId)?.institutionType as "UNIVERSITY" | "COLLEGE",
        ))
    ) return;
    await onSubmit({
      name: name.trim(),
      description: description.trim() || undefined,
      location: location.trim(),
      organizerName: organizerName.trim(),
      organizerContactName: organizerContactName.trim(),
      organizerEmail: organizerEmail.trim(),
      organizerPhone: organizerPhone.trim(),
      scope,
      allowedInstitutionIds: normalizedAllowedInstitutionIds,
      allowedInstitutionLevels,
      allInstitutionsAllowed: scope === "INTER_SCHOOL" && allInstitutionsAllowed,
      defaultMaxTeamsPerInstitution: defaultSchoolLimit ? Number(defaultSchoolLimit) : null,
      institutionTeamLimits: Object.entries(institutionLimitOverrides)
        .filter(([, value]) => value !== "default")
        .map(([institutionId, value]) => ({
          institutionId,
          maxTeams: value === "unlimited" ? null : Number(value),
        })),
      footballFormat,
      competitionFormat,
      competitionConfig: {
        ...competitionConfig,
        groupCount: competitionFormat === "GROUP_AND_KNOCKOUT" && competitionConfig.groupCountMode === "FIXED" ? competitionConfig.groupCount : null,
      },
      roundRobinLegs,
      maxTeamsPerGroup: competitionFormat === "GROUP_AND_KNOCKOUT" ? maxTeamsPerGroup : null,
      knockoutDecisionMethod,
      extraTimeMinutes,
      plannedPitchCount,
      playableHoursPerDay,
      minTeams,
      maxTeams,
      minPlayers,
      maxPlayersPerTeam,
      minGoalkeepers,
      startDate,
      endDate,
      registrationStart,
      registrationEnd,
      eligibilityDescription: eligibilityDescription.trim(),
      pointsForWin,
      pointsForDraw,
      pointsForLoss,
      rankingCriteria,
      advancingTeamsPerGroup,
      yellowCardsForSuspension,
      suspensionMatches,
      complaintWindowHours,
      minimumRestMinutes,
      matchDurationMinutes,
      forfeitPolicy,
      forfeitWinnerScore,
      forfeitLoserScore,
    });
  }

  return (
    <form className="create-panel tournament-form" onSubmit={(event) => void handleSubmit(event)}>
      <div className="panel-title-row">
        <div><span className="eyebrow">THÔNG TIN VÀ ĐIỀU LỆ</span><h2>Tạo giải đấu mới</h2></div>
        <button className="icon-button" onClick={onClose} type="button" aria-label="Đóng">×</button>
      </div>

      <section className="tournament-form-section">
        <h3>Thông tin chung</h3>
        <div className="form-grid">
          <label className="field field-wide">Tên giải đấu
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={255} required />
          </label>
          <label className="field field-wide">Mô tả
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label className="field">Địa điểm thi đấu
            <input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={255} required />
          </label>
          <label className="field">Phạm vi giải
            <select value={scope} onChange={(event) => {
              const nextScope = event.target.value as TournamentCreateInput["scope"];
              setScope(nextScope);
              if (nextScope === "SINGLE_INSTITUTION") {
                setAllInstitutionsAllowed(false);
                setAllowedInstitutionIds(userInstitutionId ? [userInstitutionId] : []);
                const institution = institutions.find((item) => item.id === userInstitutionId);
                if (institution && institution.institutionType !== "OTHER") {
                  setAllowedInstitutionLevels([institution.institutionType]);
                }
              } else {
                setAllInstitutionsAllowed(true);
                setAllowedInstitutionIds([]);
                setAllowedInstitutionLevels(["UNIVERSITY", "COLLEGE"]);
              }
            }}>
              <option value="INTER_SCHOOL">Liên trường</option>
              <option value="SINGLE_INSTITUTION">Cấp trường (nội bộ)</option>
            </select>
          </label>
          <label className="field">Đơn vị tổ chức
            <input value={organizerName} onChange={(event) => setOrganizerName(event.target.value)} maxLength={255} required />
          </label>
          <label className="field">Người liên hệ
            <input value={organizerContactName} onChange={(event) => setOrganizerContactName(event.target.value)} maxLength={255} required />
          </label>
          <label className="field">Email liên hệ
            <input type="email" value={organizerEmail} onChange={(event) => setOrganizerEmail(event.target.value)} maxLength={255} required />
          </label>
          <label className="field">Số điện thoại liên hệ
            <input type="tel" value={organizerPhone} onChange={(event) => setOrganizerPhone(event.target.value)} maxLength={50} />
          </label>
          <div className="field field-wide">
            <span>Phạm vi trường và bậc đào tạo</span>
            <small>
              {scope === "SINGLE_INSTITUTION"
                ? "Giải nội bộ chỉ nhận câu lạc bộ thuộc trường tổ chức; hồ sơ chuyển trực tiếp đến BTC giải."
                : "Chọn bậc đào tạo và cho phép tất cả trường thuộc bậc đó hoặc chỉ định từng trường."}
            </small>
            {scope === "INTER_SCHOOL" ? (
              <>
                <div className="button-row">
                  {(["UNIVERSITY", "COLLEGE"] as const).map((level) => (
                    <label className="option-item" key={level}>
                      <input
                        type="checkbox"
                        checked={allowedInstitutionLevels.includes(level)}
                        onChange={() => toggleInstitutionLevel(level)}
                      />
                      <span>{level === "UNIVERSITY" ? "Đại học" : "Cao đẳng"}</span>
                    </label>
                  ))}
                </div>
                <div className="button-row">
                  <button className="text-button" type="button" onClick={() => {
                    setAllInstitutionsAllowed(true);
                    setAllowedInstitutionIds([]);
                  }}>Cho phép tất cả trường theo bậc đã chọn</button>
                  <button className="text-button" type="button" onClick={() => {
                    setAllInstitutionsAllowed(false);
                    setAllowedInstitutionIds([]);
                  }}>Chỉ định trường</button>
                </div>
                <label className="field">
                  Tìm trường
                  <input value={institutionSearch} onChange={(event) => setInstitutionSearch(event.target.value)} placeholder="Nhập tên trường" />
                </label>
                <div className="button-row">
                  <button className="text-button" type="button" onClick={() => {
                    setAllInstitutionsAllowed(true);
                    setAllowedInstitutionIds([]);
                  }}>Chọn tất cả</button>
                  <button className="text-button" type="button" onClick={() => {
                    setAllInstitutionsAllowed(false);
                    setAllowedInstitutionIds([]);
                  }}>Bỏ chọn tất cả</button>
                </div>
                <div className="option-list">
                  {visibleInstitutions.map((institution) => (
                    <label className="option-item" key={institution.id}>
                      <input
                        type="checkbox"
                        checked={allInstitutionsAllowed || allowedInstitutionIds.includes(institution.id)}
                        onChange={() => toggleInstitution(institution.id)}
                      />
                      <span>{institution.name} · {institution.institutionType === "UNIVERSITY" ? "Đại học" : "Cao đẳng"}</span>
                    </label>
                  ))}
                </div>
                {!allInstitutionsAllowed && allowedInstitutionIds.length === 0
                  ? <small role="alert">Chọn ít nhất một trường hoặc chọn cho phép tất cả trường.</small>
                  : null}
                {!allInstitutionsAllowed && userInstitutionId && !allowedInstitutionIds.includes(userInstitutionId)
                  ? <small role="alert">Phạm vi chỉ định phải bao gồm trường tổ chức của BTC.</small>
                  : null}
              </>
            ) : (
              <p>{institutions.find((item) => item.id === userInstitutionId)?.name ?? "Chưa xác định trường tổ chức"}</p>
            )}
            {levelInstitutions.length === 0 ? <small>Không có trường đang hoạt động ở bậc đào tạo này.</small> : null}
          </div>
          {scope === "INTER_SCHOOL" ? (
            <div className="field field-wide">
              <span>Giới hạn số đội mỗi trường</span>
              <small>Để trống để không giới hạn riêng theo trường. Giới hạn tối đa toàn giải vẫn áp dụng.</small>
              <label className="field">Mặc định cho mỗi trường
                <input
                  type="number"
                  min={1}
                  value={defaultSchoolLimit}
                  onChange={(event) => setDefaultSchoolLimit(event.target.value)}
                  placeholder="Không giới hạn"
                />
              </label>
              <div className="option-list">
                {limitInstitutions.map((institution) => {
                  const value = institutionLimitOverrides[institution.id] ?? "default";
                  return (
                    <div className="option-item" key={institution.id}>
                      <span>{institution.name}</span>
                      <select
                        aria-label={`Giới hạn đội của ${institution.name}`}
                        value={value === "default" || value === "unlimited" ? value : "custom"}
                        onChange={(event) => setInstitutionLimitOverrides((current) => ({
                          ...current,
                          [institution.id]: event.target.value === "custom" ? "1" : event.target.value,
                        }))}
                      >
                        <option value="default">Dùng mặc định</option>
                        <option value="unlimited">Không giới hạn</option>
                        <option value="custom">Giới hạn riêng</option>
                      </select>
                      {value !== "default" && value !== "unlimited" ? (
                        <input
                          aria-label={`Số đội tối đa của ${institution.name}`}
                          type="number"
                          min={1}
                          value={value}
                          onChange={(event) => setInstitutionLimitOverrides((current) => ({
                            ...current,
                            [institution.id]: event.target.value,
                          }))}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="tournament-form-section">
        <h3>Thể thức và quy mô</h3>
        <div className="form-grid">
          <label className="field">Loại sân
            <select value={footballFormat} onChange={(event) => {
              const format = Number(event.target.value) as TournamentCreateInput["footballFormat"];
              setFootballFormat(format);
              setMinPlayers(format);
            }}>
                <option value={5}>5 người</option>
              <option value={7}>7 người</option>
              <option value={11}>11 người</option>
            </select>
          </label>
          <label className="field">Thể thức thi đấu
            <select value={competitionFormat} onChange={(event) => setCompetitionFormat(event.target.value as TournamentCreateInput["competitionFormat"])}>
              <option value="ROUND_ROBIN">Vòng tròn</option>
              <option value="GROUP_AND_KNOCKOUT">Vòng bảng và loại trực tiếp</option>
              <option value="KNOCKOUT">Loại trực tiếp</option>
            </select>
          </label>
          {competitionFormat === "ROUND_ROBIN" ? (
            <>
              <p className="field field-wide muted">Một bảng duy nhất gồm toàn bộ đội. Vô địch là đội đứng đầu bảng xếp hạng chung.</p>
              <label className="field">Số lượt thi đấu
                <select value={roundRobinLegs} onChange={(event) => setRoundRobinLegs(Number(event.target.value) as 1 | 2)}>
                  <option value={1}>1 lượt · mỗi cặp gặp nhau một lần</option>
                  <option value={2}>2 lượt · mỗi cặp gặp nhau hai lần</option>
                </select>
              </label>
            </>
          ) : null}
          {competitionFormat === "GROUP_AND_KNOCKOUT" ? (
            <>
              <label className="field">Cách xác định số bảng
                <select value={competitionConfig.groupCountMode} onChange={(event) => setCompetitionConfig((current) => ({ ...current, groupCountMode: event.target.value as TournamentCompetitionConfig["groupCountMode"] }))}>
                  <option value="AUTO_BY_CAPACITY">Tự tính theo số đội tối đa mỗi bảng</option>
                  <option value="FIXED">BTC chọn số bảng</option>
                </select>
              </label>
              <label className="field">Số đội tối đa mỗi bảng
                <input type="number" min={3} max={maxTeams} value={maxTeamsPerGroup}
                  onChange={(event) => setMaxTeamsPerGroup(Math.min(maxTeams, Math.max(3, Number(event.target.value) || 3)))} required />
                <small>Số đội thực tế sau khi chốt được phân bổ cân bằng, không vượt giới hạn này.</small>
              </label>
              {competitionConfig.groupCountMode === "FIXED" ? <label className="field">Số bảng
                <input type="number" min={2} max={Math.min(16, Math.floor(maxTeams / 2))} value={competitionConfig.groupCount ?? 4} onChange={(event) => setCompetitionConfig((current) => ({ ...current, groupCount: Math.max(2, Math.min(16, Number(event.target.value) || 2)) }))} required />
                <small>Số bảng phải phù hợp với số đội thực tế sau khi khóa đăng ký.</small>
              </label> : null}
              <label className="field">Số lượt vòng bảng
                <select value={roundRobinLegs} onChange={(event) => setRoundRobinLegs(Number(event.target.value) as 1 | 2)}><option value={1}>1 lượt</option><option value={2}>2 lượt</option></select>
              </label>
              <label className="field">Số đội đi tiếp mỗi bảng
                <input type="number" min={1} max={Math.max(1, maxTeamsPerGroup - 1)} value={advancingTeamsPerGroup}
                  onChange={(event) => setAdvancingTeamsPerGroup(Math.min(maxTeamsPerGroup - 1, Math.max(1, Number(event.target.value) || 1)))} required />
                <small>Các đội được xác định theo thứ hạng bảng đã chốt rồi mới ghép vào nhánh loại trực tiếp.</small>
              </label>
              <label className="field">Phân bổ bảng không đều
                <select value={competitionConfig.groupAllocation} onChange={(event) => setCompetitionConfig((current) => ({ ...current, groupAllocation: event.target.value as TournamentCompetitionConfig["groupAllocation"] }))}>
                  <option value="BALANCED">Cân bằng số đội giữa các bảng</option><option value="TOP_UP_FIRST">Ưu tiên điền bảng trước theo thứ tự</option>
                </select>
              </label>
              <label className="field">Đội cùng trường
                <select value={competitionConfig.sameInstitutionPolicy} onChange={(event) => setCompetitionConfig((current) => ({ ...current, sameInstitutionPolicy: event.target.value as TournamentCompetitionConfig["sameInstitutionPolicy"] }))}>
                  <option value="NONE">Không áp dụng</option><option value="PREFER_SEPARATE">Ưu tiên tách nếu khả thi</option><option value="REQUIRE_SEPARATE">Bắt buộc tách</option>
                </select>
              </label>
              <label className="field">Ghép nhánh loại trực tiếp
                <select value={competitionConfig.knockoutPairing} onChange={(event) => setCompetitionConfig((current) => ({ ...current, knockoutPairing: event.target.value as TournamentCompetitionConfig["knockoutPairing"] }))}>
                  <option value="GROUP_RANK">Theo thứ hạng bảng</option><option value="FIXED_CROSSOVER">Ghép chéo cố định theo bảng</option><option value="REDRAW">Bốc thăm lại</option>
                </select>
              </label>
              {competitionConfig.knockoutPairing === "FIXED_CROSSOVER" ? <label className="field">Quy tắc ghép chéo
                <select value={competitionConfig.fixedPairingRule} onChange={(event) => setCompetitionConfig((current) => ({ ...current, fixedPairingRule: event.target.value }))}>
                  <option value="STANDARD_CROSSOVER">Nhất bảng gặp nhì bảng khác, tránh cùng bảng</option><option value="ADJACENT_GROUPS">Ghép chéo bảng liền kề (A–B, C–D…)</option>
                </select>
              </label> : null}
              <label className="field">Số trận mỗi cặp playoff
                <select value={competitionConfig.knockoutLegs} onChange={(event) => setCompetitionConfig((current) => ({ ...current, knockoutLegs: Number(event.target.value) as 1 | 2 }))}><option value={1}>1 trận</option><option value={2}>2 lượt (sân nhà và sân khách)</option></select>
              </label>
              <label className="field">Tranh hạng ba
                <select value={competitionConfig.thirdPlaceMatch ? "YES" : "NO"} onChange={(event) => setCompetitionConfig((current) => ({ ...current, thirdPlaceMatch: event.target.value === "YES" }))}><option value="NO">Không</option><option value="YES">Có</option></select>
              </label>
            </>
          ) : null}
          {competitionFormat === "KNOCKOUT" ? <>
            <p className="field field-wide muted">Không chia bảng. Hệ thống tạo cây đấu từ danh sách đội đã chốt; đội thắng chỉ đi tiếp sau khi kết quả trận được duyệt.</p>
            <label className="field">Số trận mỗi cặp
              <select value={competitionConfig.knockoutLegs} onChange={(event) => setCompetitionConfig((current) => ({ ...current, knockoutLegs: Number(event.target.value) as 1 | 2 }))}><option value={1}>1 trận</option><option value={2}>2 lượt (sân nhà và sân khách)</option></select>
            </label>
            <label className="field">Tranh hạng ba
              <select value={competitionConfig.thirdPlaceMatch ? "YES" : "NO"} onChange={(event) => setCompetitionConfig((current) => ({ ...current, thirdPlaceMatch: event.target.value === "YES" }))}><option value="NO">Không</option><option value="YES">Có</option></select>
            </label>
          </> : null}
          <label className="field">Số đội tối thiểu
            <input type="number" min={2} max={maxTeams} value={minTeams} onChange={(event) => setMinTeams(Number(event.target.value))} required />
          </label>
          <label className="field">Số đội tối đa
            <input type="number" min={minTeams} value={maxTeams} onChange={(event) => {
              const next = Math.max(minTeams, Number(event.target.value) || minTeams);
              setMaxTeams(next);
              setMaxTeamsPerGroup((current) => Math.min(current, next));
            }} required />
          </label>
          <label className="field">Cầu thủ tối thiểu mỗi đội
            <input type="number" min={footballFormat} max={maxPlayersPerTeam} value={minPlayers} onChange={(event) => setMinPlayers(Number(event.target.value))} required />
          </label>
          <label className="field">Cầu thủ tối đa mỗi đội
            <input type="number" min={minPlayers} value={maxPlayersPerTeam} onChange={(event) => setMaxPlayersPerTeam(Number(event.target.value))} required />
          </label>
          <label className="field">Thủ môn tối thiểu trong roster
            <input type="number" min={0} max={maxPlayersPerTeam} value={minGoalkeepers} onChange={(event) => setMinGoalkeepers(Number(event.target.value))} required />
            <small>Áp dụng theo điều lệ; đội hình xuất phát vẫn cần đúng 1 thủ môn.</small>
          </label>
        </div>
      </section>

      <section className="tournament-form-section">
        <h3>Thời gian</h3>
        <div className="form-grid">
          <label className="field">Bắt đầu nhận đăng ký
            <input type="date" value={registrationStart} max={registrationEnd || startDate || undefined} onChange={(event) => setRegistrationStart(event.target.value)} required />
          </label>
          <label className="field">Hạn đăng ký
            <input type="date" value={registrationEnd} min={registrationStart || undefined} max={startDate || undefined} onChange={(event) => setRegistrationEnd(event.target.value)} required />
          </label>
          <label className="field">Ngày khai mạc
            <input type="date" value={startDate} min={registrationEnd || undefined} max={endDate || undefined} onChange={(event) => setStartDate(event.target.value)} required />
          </label>
          <label className="field">Ngày kết thúc
            <input type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} required />
          </label>
          <label className="field">Số sân dự kiến có thể sử dụng
            <input type="number" min={1} max={30} value={plannedPitchCount} onChange={(event) => setPlannedPitchCount(Math.min(30, Math.max(1, Number(event.target.value) || 1)))} required />
          </label>
          <label className="field">Thời gian tổ chức mỗi ngày (giờ)
            <input type="number" min={1} max={24} step={0.5} value={playableHoursPerDay} onChange={(event) => setPlayableHoursPerDay(Math.min(24, Math.max(1, Number(event.target.value) || 1)))} required />
          </label>
          <label className="field">Khung giờ bắt đầu nhận trận
            <input type="time" value={competitionConfig.schedulingStartTime} onChange={(event) => setCompetitionConfig((current) => ({ ...current, schedulingStartTime: event.target.value }))} required />
          </label>
          <label className="field">Khung giờ kết thúc nhận trận
            <input type="time" value={competitionConfig.schedulingEndTime} onChange={(event) => setCompetitionConfig((current) => ({ ...current, schedulingEndTime: event.target.value }))} required />
          </label>
          <div className="field field-wide tournament-schedule-estimate" role="status" aria-live="polite">
            <strong>Ước tính khả năng tổ chức</strong>
            <span>{scheduleEstimate.groupCount} bảng · {scheduleEstimate.groupRounds} vòng bảng · {scheduleEstimate.knockoutRounds} vòng loại trực tiếp · {scheduleEstimate.totalMatches} trận tối đa (vòng bảng {scheduleEstimate.groupMatches}, playoff {scheduleEstimate.playoffMatches}) · tối thiểu khoảng {scheduleEstimate.estimatedDays} ngày với {plannedPitchCount} sân.</span>
            {scheduleEstimate.invalidSchedulingWindow ? <span className="schedule-estimate-warning">Khung giờ kết thúc phải sau khung giờ bắt đầu.</span> : null}
            {scheduleEstimate.availableDays > 0 ? (
              <span className={scheduleEstimate.estimatedDays <= scheduleEstimate.availableDays && !scheduleEstimate.invalidAdvancement ? "schedule-estimate-ok" : "schedule-estimate-warning"}>
                {scheduleEstimate.invalidAdvancement
                  ? "Cấu hình không hợp lệ: số bảng, sức chứa hoặc suất đi tiếp không phù hợp với số đội tối đa."
                  : scheduleEstimate.estimatedDays <= scheduleEstimate.availableDays
                    ? `Khoảng thời gian hiện có ${scheduleEstimate.availableDays} ngày; lịch sơ bộ có thể bố trí.`
                    : `Khoảng thời gian chỉ có ${scheduleEstimate.availableDays} ngày; cần thêm ngày thi đấu hoặc tăng số sân/giờ hoạt động.`}
              </span>
            ) : <span>Chọn ngày khai mạc và kết thúc để kiểm tra khoảng thời gian.</span>}
            <small>Đây là ước tính sơ bộ theo công suất sân, thời lượng trận và thời gian nghỉ. Bước xếp lịch sẽ kiểm tra lại giờ đá, trùng đội/sân và thời gian nghỉ thực tế.</small>
          </div>
        </div>
      </section>

      <section className="tournament-form-section">
        <h3>Điều lệ và tính điểm</h3>
        <div className="form-grid">
          <label className="field field-wide">Điều kiện tham gia
            <textarea value={eligibilityDescription} onChange={(event) => setEligibilityDescription(event.target.value)} placeholder="Mô tả điều kiện sinh viên, hồ sơ cần nộp..." />
          </label>
          <label className="field">Điểm thắng
            <input type="number" min={0} value={pointsForWin} onChange={(event) => setPointsForWin(Number(event.target.value))} required />
          </label>
          <label className="field">Điểm hòa
            <input type="number" min={0} value={pointsForDraw} onChange={(event) => setPointsForDraw(Number(event.target.value))} required />
          </label>
          <label className="field">Điểm thua
            <input type="number" min={0} value={pointsForLoss} onChange={(event) => setPointsForLoss(Number(event.target.value))} required />
          </label>
          {competitionFormat === "ROUND_ROBIN" ? <p className="field field-wide muted">Giải vòng tròn một bảng không có vòng loại trực tiếp; cấu hình đội đi tiếp chỉ áp dụng cho giải kết hợp.</p> : null}
          {competitionFormat !== "ROUND_ROBIN" ? (
            <>
              <label className="field">Phân định thắng thua khi hòa
                <select value={knockoutDecisionMethod} onChange={(event) => setKnockoutDecisionMethod(event.target.value as TournamentCreateInput["knockoutDecisionMethod"])}>
                  <option value="PENALTIES_ONLY">Đá luân lưu trực tiếp</option>
                  <option value="EXTRA_TIME_THEN_PENALTIES">Hiệp phụ 2×15 phút, sau đó luân lưu</option>
                </select>
              </label>
              {knockoutDecisionMethod === "EXTRA_TIME_THEN_PENALTIES" ? (
                <>
                  <label className="field">Thời lượng hiệp phụ (tổng phút)
                    <input type="number" min={1} max={60} value={extraTimeMinutes} onChange={(event) => setExtraTimeMinutes(Math.min(60, Math.max(1, Number(event.target.value) || 1)))} required />
                  </label>
                  <p className="field field-wide muted">Nếu vẫn hòa sau thời lượng hiệp phụ đã cấu hình, trận đấu được phân định bằng loạt luân lưu.</p>
                </>
              ) : null}
            </>
          ) : null}
          <div className="field field-wide">
            <span>Thứ tự tiêu chí xếp hạng</span>
            <div className="option-list">
              {rankingOptions.map(({ value, label }) => (
                <div className="ranking-option" key={value}>
                  <label className="option-item">
                    <input type="checkbox" checked={rankingCriteria.includes(value)} disabled={value === "POINTS"} onChange={() => toggleRankingCriterion(value)} />
                    <span>{label}{rankingCriteria.includes(value) ? ` — ưu tiên ${rankingCriteria.indexOf(value) + 1}` : ""}</span>
                  </label>
                  {rankingCriteria.includes(value) && value !== "POINTS" ? (
                    <span className="ranking-order-buttons">
                      <button type="button" aria-label={`Đưa ${label} lên`} disabled={rankingCriteria.indexOf(value) === 1} onClick={() => moveRankingCriterion(value, -1)}>↑</button>
                      <button type="button" aria-label={`Đưa ${label} xuống`} disabled={rankingCriteria.indexOf(value) === rankingCriteria.length - 1} onClick={() => moveRankingCriterion(value, 1)}>↓</button>
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
            <small>Điểm số luôn đứng đầu. Dùng mũi tên để thay đổi ưu tiên các tiêu chí còn lại.</small>
          </div>
          <label className="field">Thẻ vàng gây treo giò
            <input type="number" min={1} value={yellowCardsForSuspension} onChange={(event) => setYellowCardsForSuspension(Number(event.target.value))} required />
          </label>
          <label className="field">Số trận treo giò
            <input type="number" min={1} value={suspensionMatches} onChange={(event) => setSuspensionMatches(Number(event.target.value))} required />
          </label>
          <label className="field">Thời hạn khiếu nại (giờ)
            <input type="number" min={1} value={complaintWindowHours} onChange={(event) => setComplaintWindowHours(Number(event.target.value))} required />
          </label>
          <label className="field">Thời gian nghỉ tối thiểu (phút)
            <input type="number" min={30} value={minimumRestMinutes} onChange={(event) => setMinimumRestMinutes(Number(event.target.value))} required />
          </label>
          <label className="field">Thời lượng trận (phút)
            <input type="number" min={1} value={matchDurationMinutes} onChange={(event) => setMatchDurationMinutes(Number(event.target.value))} required />
          </label>
          <label className="field">Xử lý bỏ cuộc
            <select value={forfeitPolicy} onChange={(event) => setForfeitPolicy(event.target.value as TournamentCreateInput["forfeitPolicy"])}>
              <option value="ORGANIZER_DECISION">Ban tổ chức xem xét</option>
              <option value="WALKOVER">Xử thắng theo điều lệ</option>
              <option value="NO_AUTOMATIC_RESULT">Không tự động ghi kết quả</option>
            </select>
          </label>
          <label className="field">Tỷ số đội thắng khi bỏ cuộc
            <input type="number" min={0} value={forfeitWinnerScore} onChange={(event) => setForfeitWinnerScore(Number(event.target.value))} required />
          </label>
          <label className="field">Tỷ số đội thua khi bỏ cuộc
            <input type="number" min={0} value={forfeitLoserScore} onChange={(event) => setForfeitLoserScore(Number(event.target.value))} required />
          </label>
        </div>
      </section>

      <button
        className="primary-button"
        disabled={disabled ||
          allowedInstitutionLevels.length === 0 ||
          (scope === "SINGLE_INSTITUTION" && allowedInstitutionIds.length !== 1) ||
          (scope === "INTER_SCHOOL" && !allInstitutionsAllowed &&
            (allowedInstitutionIds.length === 0 || !allowedInstitutionIds.includes(userInstitutionId ?? "")))}
      >
        {disabled ? "Đang tạo…" : "Lưu giải đấu"} <span>↗</span>
      </button>
    </form>
  );
}
