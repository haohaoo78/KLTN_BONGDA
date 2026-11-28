import { buildAutomaticRefereePlan, type AutoRefereePlannerInput } from "../utils/automaticRefereePlanner";

const workerScope = self as unknown as {
  addEventListener(type: "message", listener: (event: MessageEvent<AutoRefereePlannerInput>) => void): void;
  postMessage(message: unknown): void;
};
workerScope.addEventListener("message", (event: MessageEvent<AutoRefereePlannerInput>) => {
  try {
    workerScope.postMessage({ ok: true, plan: buildAutomaticRefereePlan(event.data) });
  } catch (error) {
    workerScope.postMessage({ ok: false, error: error instanceof Error ? error.message : "Không thể tính phương án trọng tài." });
  }
});
