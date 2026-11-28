import type { ReactNode } from "react";

export type Step5Stage = 1 | 2 | 3 | 4 | 5;

const stages: Array<{ id: Step5Stage; title: string; hint: string }> = [
  { id: 1, title: "Sân & thời gian", hint: "Chọn nơi và giờ tổ chức" },
  { id: 2, title: "Điều kiện thi đấu", hint: "Kiểm tra các giới hạn" },
  { id: 3, title: "Tạo & điều chỉnh lịch", hint: "Chọn trận để chỉnh sửa hoặc chạy thuật toán" },
  { id: 4, title: "Kiểm tra & in lịch", hint: "Rà soát từng trận" },
  { id: 5, title: "Hoàn tất & công bố", hint: "Rà soát lần cuối" },
];

type Props = {
  heading: ReactNode;
  activeStage: Step5Stage;
  stageStates: Record<Step5Stage, "complete" | "current" | "attention" | "upcoming">;
  onSelectStage: (stage: Step5Stage) => void;
  preparation: ReactNode;
  guidance: ReactNode;
  actions: ReactNode;
  creation: ReactNode;
  viewToolbar: ReactNode;
  simulatedPlan?: ReactNode;
  workspace: ReactNode;
  completion: ReactNode;
  printPreview?: ReactNode;
  review?: ReactNode;
  overlays?: ReactNode;
  showStageControls?: boolean;
  stageCount?: 4 | 5;
  canContinue?: boolean;
  continueLabel?: string;
};

/** Compact work stages share the same scheduling rules and backend state. */
export function Step5WorkspaceShell({ heading, activeStage, stageStates, onSelectStage, preparation, guidance, actions, creation, viewToolbar, simulatedPlan, workspace, completion, printPreview, review, overlays, showStageControls = true, stageCount = 5, canContinue = true, continueLabel = "Lưu và tiếp tục →" }: Props) {
  const visibleStages = stageCount === 4
    ? stages.slice(0, 4).map((stage) => stage.id === 4 ? { ...stage, title: "Kiểm tra & công bố", hint: "Rà soát lịch trước khi công bố" } : stage)
    : stages;
  const safeActiveStage = Math.min(activeStage, stageCount) as Step5Stage;
  const current = visibleStages.find((stage) => stage.id === safeActiveStage)!;
  const stageContent: Record<Step5Stage, ReactNode> = {
    1: null,
    2: null,
    3: stageCount === 4 ? <>{guidance}{creation}{simulatedPlan}<div className="step5-ws-browse-column">{viewToolbar}{workspace}</div>{actions}</> : <>{guidance}{actions}{creation}</>,
    4: stageCount === 4 ? <>{review}<div className="step5-ws-review-toolbar-row">{viewToolbar}{printPreview}</div>{workspace}{completion}</> : <>{viewToolbar}{simulatedPlan}{workspace}{printPreview}</>,
    5: <>{completion}{review}</>,
  };
  return <section className="step5-workspace" aria-label="Không gian lập lịch thi đấu">
    {heading}
    <nav className={`step5-process-nav ${stageCount === 4 ? "is-four-stage" : ""}`} aria-label={`${stageCount} công đoạn lập lịch`}>
      {visibleStages.map((stage, index) => {
        const status = stageStates[stage.id];
        return <button key={stage.id} type="button" className={`step5-process-step is-${status}`} aria-current={safeActiveStage === stage.id ? "step" : undefined} onClick={() => onSelectStage(stage.id)}>
          <span className="step5-process-number">{status === "complete" ? "✓" : stage.id}</span>
          <span className="step5-process-copy"><b>{stage.title}</b><small>{status === "complete" ? "Đã sẵn sàng" : status === "attention" ? "Cần kiểm tra" : status === "current" ? "Đang thực hiện" : stage.hint}</small></span>
          {index < visibleStages.length - 1 ? <i className="step5-process-connector" aria-hidden="true" /> : null}
        </button>;
      })}
    </nav>
    <section className="step5-stage-content" aria-labelledby="step5-active-stage-title">
      <header className="step5-stage-heading"><div><span className="eyebrow">CÔNG ĐOẠN {safeActiveStage} / {stageCount}</span><h3 id="step5-active-stage-title">{current.title}</h3><p>{current.hint}</p></div></header>
      <div className="step5-stage-preparation-host" hidden={safeActiveStage > 2} aria-hidden={safeActiveStage > 2 || undefined}>{preparation}</div>
      {safeActiveStage > 2 ? stageContent[safeActiveStage] : null}
      {showStageControls ? <footer className="step5-stage-footer"><button className="button button-secondary" type="button" disabled={safeActiveStage === 1} onClick={() => onSelectStage((safeActiveStage - 1) as Step5Stage)}>← Quay lại</button><span>{current.title}</span>{safeActiveStage < stageCount ? <button className="button button-primary" type="button" disabled={safeActiveStage === 3 && !canContinue} onClick={() => onSelectStage((safeActiveStage + 1) as Step5Stage)}>{continueLabel}</button> : null}</footer> : null}
    </section>
    {overlays}
  </section>;
}
