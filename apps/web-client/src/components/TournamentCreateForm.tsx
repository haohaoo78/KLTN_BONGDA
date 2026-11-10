import { useState, type FormEvent } from "react";
import type { TournamentCreateInput } from "../api/competition";
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
  const [minTeams, setMinTeams] = useState(2);
  const [maxTeams, setMaxTeams] = useState(16);
  const [minPlayers, setMinPlayers] = useState(7);
  const [maxPlayersPerTeam, setMaxPlayersPerTeam] = useState(25);
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
      minTeams,
      maxTeams,
      minPlayers,
      maxPlayersPerTeam,
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
          <label className="field">Số đội tối thiểu
            <input type="number" min={2} max={maxTeams} value={minTeams} onChange={(event) => setMinTeams(Number(event.target.value))} required />
          </label>
          <label className="field">Số đội tối đa
            <input type="number" min={minTeams} value={maxTeams} onChange={(event) => setMaxTeams(Number(event.target.value))} required />
          </label>
          <label className="field">Cầu thủ tối thiểu mỗi đội
            <input type="number" min={footballFormat} max={maxPlayersPerTeam} value={minPlayers} onChange={(event) => setMinPlayers(Number(event.target.value))} required />
          </label>
          <label className="field">Cầu thủ tối đa mỗi đội
            <input type="number" min={minPlayers} value={maxPlayersPerTeam} onChange={(event) => setMaxPlayersPerTeam(Number(event.target.value))} required />
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
          <label className="field">Đội đi tiếp mỗi bảng
            <input type="number" min={1} value={advancingTeamsPerGroup} onChange={(event) => setAdvancingTeamsPerGroup(Number(event.target.value))} required />
          </label>
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
