import { shellStrings } from "../strings/common";
import { cx, ProgressBar } from "../ui";
import "./SplashScreen.css";

export type BootStepStatus = "pending" | "active" | "done" | "error";
export type BootStep = { id: string; label: string; status: BootStepStatus };

export type SplashScreenProps = {
  steps: BootStep[];
  /** Plays the exit animation; the parent unmounts the splash afterwards. */
  leaving?: boolean;
};

/** Boot screen fed by the real bootstrap state (see App.tsx `bootSteps`). */
export function SplashScreen({ steps, leaving = false }: SplashScreenProps) {
  const done = steps.filter((step) => step.status === "done").length;
  const current = steps.find((step) => step.status === "error")
    ?? steps.find((step) => step.status === "active")
    ?? steps[steps.length - 1];
  return (
    <div className={cx("o-splash", leaving && "o-splash--leaving")} data-testid="splash-screen" data-tauri-drag-region>
      <div className="o-splash__card">
        <img className="o-splash__logo" src="/icons/oghma-loop.svg" alt="" draggable={false} />
        <p className="o-splash__title">{shellStrings.appName}</p>
        <p className="o-splash__step" role="status">{current?.label}</p>
        <ProgressBar className="o-splash__progress" size="sm" value={done} max={Math.max(steps.length, 1)} label={current?.label ?? shellStrings.appName} />
      </div>
    </div>
  );
}
