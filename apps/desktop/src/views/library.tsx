import { MouseEvent, PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FolderOpen,
  Globe2,
  GripVertical,
  Headphones,
  Home,
  Languages,
  Library,
  Loader2,
  Minus,
  Pause,
  Play,
  RefreshCcw,
  Search,
  Settings,
  CheckSquare,
  SlidersHorizontal,
  Square,
  Trash2,
  X
} from "lucide-react";
import { defaultAppConfig } from "../appConfig";
import { downloadFormats } from "../types";
import { defaultFilters, defaultSelection, estimateChapters, selectionLabel } from "../mockBackend";
import type {
  AppConfig,
  ChapterSelection,
  DownloadFormat,
  Filters,
  IndexMode,
  LibraryItem,
  Novel,
  QueueItem,
  ServerProbe,
  SourceSite,
  TranslationEngine,
  ViewId
} from "../types";
import { runWindowAction } from "../windowControls";
import {
  indexModeOptions,
  onboardingSteps,
  pageTitle,
  statusLabel,
  tags,
  translationEngineOptions,
  views,
  type SetupSyncEntry
} from "../constants/ui";

export function LibraryView({ library, onOpenFolder }: { library: LibraryItem[]; onOpenFolder: () => void }) {
  return (
    <section className="page-area full-span">
      <div className="page-header">
        <button className="button quiet" onClick={onOpenFolder}>
          <FolderOpen size={16} />
          Abrir pasta
        </button>
      </div>
      <div className="library-grid">
        {library.map((item) => (
          <article className="library-card" key={item.id}>
            <div
              className={`book-cover ${item.coverClass}`}
              style={item.coverUrl ? { backgroundImage: `url("${item.coverUrl}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
            />
            <div>
              <strong>{item.title}</strong>
              <small>{item.author}</small>
              <p>{(item.formats?.length ? item.formats : [item.format]).join(", ")} - {item.chapters || "?"} capitulos - {item.sizeMb} MB</p>
            </div>
            <button className="icon-button small" title="Exportar">
              <ExternalLink size={15} />
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
