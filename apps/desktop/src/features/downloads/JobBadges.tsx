import { Headphones, Languages, RefreshCw } from "lucide-react";
import type { DownloadJob } from "../../core/types";
import { downloadsStrings } from "../../strings/downloads";
import { Badge } from "../../ui";
import { filesForFormat } from "./format";

/** Formats (and extras such as audiobook) of a job, as badges. Done jobs list their files in the tooltip. */
export function JobBadges({ job }: { job: DownloadJob }) {
  const done = job.status === "done";
  return (
    <span className="downloads-badges">
      {job.kind === "convert" ? (
        <Badge>
          <RefreshCw aria-hidden="true" />
          {downloadsStrings.conversion}
        </Badge>
      ) : null}
      {job.request.formats.map((format) => (
        <Badge key={format} tone={done ? "accent" : "neutral"} title={done ? filesForFormat(job, format) : undefined}>
          {format}
        </Badge>
      ))}
      {job.request.translate ? (
        <Badge>
          <Languages aria-hidden="true" />
          {downloadsStrings.translated}
        </Badge>
      ) : null}
      {job.request.audiobook ? (
        <Badge>
          <Headphones aria-hidden="true" />
          {downloadsStrings.audiobook}
        </Badge>
      ) : null}
    </span>
  );
}
