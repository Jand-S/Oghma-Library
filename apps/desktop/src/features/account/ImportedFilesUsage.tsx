import { HardDrive } from "lucide-react";
import { useEffect, useState } from "react";
import { formatBytes } from "../downloads/format";
import type { AccountFilesUsage } from "../../services/importClient";
import { accountFilesStrings as s } from "../../strings/accountFiles";
import { ListRow, ProgressBar, Spinner } from "../../ui";
import "./importedUsage.css";

type Props = {
  usage: () => Promise<AccountFilesUsage>;
  /** Reloads after each sync (books may have gone up meanwhile). */
  refreshKey?: number | null;
};

/** Ajustes › Conta: "Livros importados: X de Y" (account_files_usage), with a quota meter. */
export function ImportedFilesUsage({ usage, refreshKey }: Props) {
  const [state, setState] = useState<{ usage: AccountFilesUsage | null; failed: boolean }>({ usage: null, failed: false });

  useEffect(() => {
    let cancelled = false;
    void usage()
      .then((value) => {
        if (!cancelled) setState({ usage: value, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState((current) => ({ usage: current.usage, failed: !current.usage }));
      });
    return () => {
      cancelled = true;
    };
  }, [usage, refreshKey]);

  const value = state.usage;
  if (!value) {
    return (
      <ListRow icon={<HardDrive />} label={s.usageLabel} description={state.failed ? s.usageUnavailable : undefined}>
        {state.failed ? null : <Spinner size="sm" />}
      </ListRow>
    );
  }
  const used = formatBytes(value.usedBytes);
  const quota = formatBytes(value.quotaBytes);
  const full = value.quotaBytes > 0 && value.usedBytes / value.quotaBytes >= 0.9;
  return (
    <ListRow
      icon={<HardDrive />}
      label={s.usageLabel}
      description={`${s.usageValue(used, quota)} · ${s.usageFiles(value.files)}`}
    >
      <ProgressBar
        className="imported-usage__meter"
        size="sm"
        value={value.usedBytes}
        max={value.quotaBytes}
        label={s.usageSummary(used, quota)}
        valueText={s.usageValue(used, quota)}
        tone={full ? "danger" : "accent"}
      />
    </ListRow>
  );
}
