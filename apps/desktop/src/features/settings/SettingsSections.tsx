import { ArrowRight, Cloud, Download, ExternalLink, Github, Globe2, Languages, LogOut, RefreshCcw, RotateCcw, Usb, Wifi } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import type { AppView } from "../../app/NavigationContext";
import type { AppConfig, ChapterPreset, IndexMode, KindleDeviceStatus, KindleSendMethod, SourceSite } from "../../core/types";
import { getErrorMessage } from "../../services/backendClient";
import { getICloudStatus, setExportRoot } from "../../services/localFiles";
import { navStrings } from "../../strings/common";
import { onboardingStrings } from "../../strings/onboarding";
import { settingsLinks, settingsStrings } from "../../strings/settings";
import { modelLabel, translationSettingsStrings, translationStrings } from "../../strings/translation";
import type { TranslationEffort, TranslationModelId } from "../../services/translationClient";
import type { TranslationAccountState } from "../translation/useTranslationController";
import {
  Badge,
  Button,
  ConfirmationModal,
  SegmentedControl,
  SelectField,
  Spinner,
  Switch,
  TextField,
  cx,
  useToast
} from "../../ui";
import { formatSyncTime } from "../sources/lastSync";
import type { ServerCheck } from "../sources/useSourcesController";
import { fallbackAppVersion, getAppVersion, openExternal } from "./appInfo";
import { FolderField } from "./FolderField";
import { FormatPicker, toggleFormat } from "./FormatPicker";
import {
  DEFAULT_ICLOUD_FOLDER,
  normalizeICloudFolder,
  SEND_TO_KINDLE_URL,
  startPages,
  TRANSLATION_WORKERS_MAX,
  translationModels,
  useIntegrationPreferences,
  useTranslationPreferences,
  useUiPreferences,
  type StartPage
} from "./preferences";
import { serverStateFor, ServerStatusBadge } from "./ServerStatusBadge";

type Save = (patch: Partial<AppConfig>) => void;
type Navigate = (view: AppView) => void;

/* ---------- Layout helpers ---------- */

function SettingsGroup({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="settings-group" aria-labelledby={id}>
      <header className="settings-group__header">
        <h3 className="settings-group__title" id={id}>{title}</h3>
        <p className="settings-group__description">{description}</p>
      </header>
      <div className="settings-group__rows">{children}</div>
    </section>
  );
}

/**
 * One setting: text on the left, control on the right (`stacked` puts the control below).
 * With `htmlFor` the title is a real `<label>`; the control should then point
 * `aria-labelledby` at `labelId` so its accessible name is not doubled.
 */
function SettingsRow({
  label,
  labelId,
  htmlFor,
  description,
  children,
  stacked = false,
  testId
}: {
  label: ReactNode;
  labelId?: string;
  htmlFor?: string;
  description?: ReactNode;
  children: ReactNode;
  stacked?: boolean;
  testId?: string;
}) {
  return (
    <div className={cx("settings-row", stacked && "settings-row--stacked")} data-testid={testId}>
      <div className="settings-row__text">
        {htmlFor ? (
          <label className="settings-row__label" id={labelId} htmlFor={htmlFor}>{label}</label>
        ) : (
          <span className="settings-row__label" id={labelId}>{label}</span>
        )}
        {description ? <p className="settings-row__description">{description}</p> : null}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  );
}

/** A switch row: the Switch primitive already lays out label, description and track. */
function SwitchRow(props: { label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <div className="settings-row settings-row--switch">
      <Switch {...props} className="settings-switch" />
    </div>
  );
}

/**
 * Local draft for a text setting. The config only changes on commit (blur/Enter) and
 * only when the value is valid; otherwise the error is shown inline on the field.
 */
function useDraft(value: string, validate: (value: string) => string | null, commit: (value: string) => void) {
  const [draft, setDraftState] = useState(value);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraftState(value);
    setError(null);
  }, [value]);

  const setDraft = (next: string) => {
    setDraftState(next);
    if (error) setError(null);
  };

  /** Validates and saves the draft. Returns the saved value, or null when invalid. */
  const flush = (): string | null => {
    const next = draft.trim();
    const problem = validate(next);
    if (problem) {
      setError(problem);
      return null;
    }
    if (next !== value) commit(next);
    if (next !== draft) setDraftState(next);
    return next;
  };

  return { draft, setDraft, error, flush };
}

function validateServerUrl(value: string) {
  if (!value) return settingsStrings.serverUrlRequired;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return settingsStrings.serverUrlInvalid;
  } catch {
    return settingsStrings.serverUrlInvalid;
  }
  return null;
}

const validateFolder = (value: string) => (value ? null : settingsStrings.outputPathRequired);

/* ---------- Geral ---------- */

export function GeneralSection({ saved }: { saved: () => void }) {
  const [preferences, updatePreferences] = useUiPreferences();
  const languageId = useId();
  const startId = useId();
  const themeId = useId();
  const startOptions = startPages.map((page) => ({ value: page, label: navStrings[page] }));

  return (
    <>
      <SettingsGroup {...settingsStrings.groups.locale}>
        <SettingsRow label={settingsStrings.language} labelId={`${languageId}-label`} htmlFor={languageId} description={settingsStrings.languageHint}>
          <SelectField
            id={languageId}
            label={settingsStrings.language}
            hideLabel
            aria-labelledby={`${languageId}-label`}
            options={[{ value: "pt-BR", label: settingsStrings.languagePtBr }]}
            value="pt-BR"
            disabled
            onChange={() => undefined}
          />
        </SettingsRow>
        <SettingsRow label={settingsStrings.startPage} labelId={`${startId}-label`} htmlFor={startId} description={settingsStrings.startPageHint}>
          <SelectField<StartPage>
            id={startId}
            label={settingsStrings.startPage}
            hideLabel
            aria-labelledby={`${startId}-label`}
            options={startOptions}
            value={preferences.startPage}
            onChange={(event) => {
              updatePreferences({ startPage: event.target.value as StartPage });
              saved();
            }}
          />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup {...settingsStrings.groups.appearance}>
        <SettingsRow label={settingsStrings.theme} labelId={`${themeId}-label`} htmlFor={themeId} description={settingsStrings.themeHint}>
          <SelectField
            id={themeId}
            label={settingsStrings.theme}
            hideLabel
            aria-labelledby={`${themeId}-label`}
            options={[{ value: "dark", label: settingsStrings.themeDark }]}
            value="dark"
            disabled
            onChange={() => undefined}
          />
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

/* ---------- Downloads ---------- */

export function DownloadsSection({ config, save, saved, onNavigate }: { config: AppConfig; save: Save; saved: () => void; onNavigate: Navigate }) {
  const [preferences, updatePreferences] = useUiPreferences();
  const folderId = useId();
  const { toast } = useToast();
  // A typed folder only becomes the output root if Rust accepts it (missing, empty or an Oghma library).
  const folder = useDraft(config.outputPath, validateFolder, (outputPath) => {
    void setExportRoot(outputPath)
      .then(() => save({ outputPath }))
      .catch((err: unknown) => toast({ message: getErrorMessage(err, settingsStrings.outputPathRefused), tone: "danger" }));
  });

  return (
    <>
      <SettingsGroup {...settingsStrings.groups.folder}>
        <SettingsRow stacked label={settingsStrings.outputPath} labelId={`${folderId}-label`} htmlFor={folderId}>
          <FolderField
            id={folderId}
            label={settingsStrings.outputPath}
            hideLabel
            labelledBy={`${folderId}-label`}
            value={folder.draft}
            onChange={folder.setDraft}
            onCommit={() => void folder.flush()}
            onPick={(outputPath) => save({ outputPath })}
            hint={settingsStrings.outputPathHint}
            error={folder.error}
            showOpen
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup {...settingsStrings.groups.downloadDefaults}>
        <SettingsRow stacked label={settingsStrings.defaultFormats}>
          <FormatPicker
            label={settingsStrings.defaultFormats}
            hideLabel
            hint={settingsStrings.defaultFormatsHint}
            value={config.defaultFormats}
            onChange={(defaultFormats) => save({ defaultFormats })}
          />
        </SettingsRow>
        <SettingsRow label={settingsStrings.chapterPreset} description={settingsStrings.chapterPresetHint}>
          <SegmentedControl<ChapterPreset>
            aria-label={settingsStrings.chapterPreset}
            value={preferences.chapterPreset}
            onChange={(chapterPreset) => {
              updatePreferences({ chapterPreset });
              saved();
            }}
            options={[
              { value: "all", label: settingsStrings.chapterPresets.all },
              { value: "range", label: settingsStrings.chapterPresets.range }
            ]}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup {...settingsStrings.groups.queue}>
        <div className="settings-note">
          <div className="settings-note__text">
            <strong>{settingsStrings.queueNoteTitle}</strong>
            <p>{settingsStrings.queueNote}</p>
          </div>
          <Button variant="ghost" size="sm" iconRight={<ArrowRight />} onClick={() => onNavigate("downloads")}>
            {settingsStrings.openDownloads}
          </Button>
        </div>
      </SettingsGroup>
    </>
  );
}

/* ---------- Fontes / Servidor ---------- */

export function ServerSection({
  config,
  save,
  sources,
  syncingSourceIds,
  lastSyncedAt,
  onSyncSources,
  serverCheck,
  onVerifyServer,
  onNavigate
}: {
  config: AppConfig;
  save: Save;
  sources: SourceSite[];
  syncingSourceIds: string[];
  lastSyncedAt: number | null;
  onSyncSources: () => Promise<boolean>;
  serverCheck: ServerCheck;
  onVerifyServer: (serverUrl: string, indexMode: IndexMode) => void;
  onNavigate: Navigate;
}) {
  const urlId = useId();
  const modeId = useId();
  const server = useDraft(config.serverUrl, validateServerUrl, (serverUrl) => save({ serverUrl }));
  const state = serverStateFor(config.serverUrl, { probe: serverCheck.probe, checking: serverCheck.checking, failedUrl: serverCheck.errorUrl });
  const probe = state === "online" ? serverCheck.probe : null;
  const enabled = sources.filter((source) => source.enabled);
  const syncing = syncingSourceIds.length > 0;

  const verify = () => {
    const url = server.flush();
    if (url) onVerifyServer(url, config.indexMode);
  };

  const fieldError = server.error ?? (state === "failed" ? serverCheck.error : null);

  return (
    <>
      <SettingsGroup {...settingsStrings.groups.server}>
        <SettingsRow stacked label={settingsStrings.serverUrl} labelId={`${urlId}-label`} htmlFor={urlId}>
          <div className="settings-inline">
            <TextField
              id={urlId}
              label={settingsStrings.serverUrl}
              hideLabel
              aria-labelledby={`${urlId}-label`}
              type="url"
              inputMode="url"
              spellCheck={false}
              leading={<Globe2 />}
              value={server.draft}
              hint={settingsStrings.serverUrlHint}
              error={fieldError}
              fieldClassName="settings-inline__grow"
              onChange={(event) => server.setDraft(event.target.value)}
              onBlur={() => void server.flush()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  verify();
                }
              }}
            />
            <Button icon={<RefreshCcw />} loading={serverCheck.checking} onClick={verify} disabled={!server.draft.trim()}>
              {onboardingStrings.validateServer}
            </Button>
          </div>
        </SettingsRow>
        <SettingsRow label={settingsStrings.serverStatus} description={probe ? settingsStrings.serverDetails(probe.serverName, probe.version, probe.sourceCount) : undefined} testId="server-status">
          <ServerStatusBadge state={state} probe={probe} />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup {...settingsStrings.groups.sync}>
        <SettingsRow
          label={settingsStrings.lastSync}
          description={enabled.length > 0 ? settingsStrings.enabledSources(enabled.length, sources.length) : settingsStrings.noEnabledSources}
          testId="last-sync"
        >
          <div className="settings-inline settings-inline--end">
            <span className="settings-value">{lastSyncedAt ? formatSyncTime(lastSyncedAt) : settingsStrings.lastSyncNever}</span>
            <Button icon={<RefreshCcw />} loading={syncing} disabled={enabled.length === 0} onClick={() => void onSyncSources()}>
              {settingsStrings.syncNow}
            </Button>
          </div>
        </SettingsRow>
        <div className="settings-row settings-row--link">
          <Button variant="ghost" size="sm" iconRight={<ArrowRight />} onClick={() => onNavigate("sources")}>
            {settingsStrings.manageSources}
          </Button>
        </div>
      </SettingsGroup>
    </>
  );
}

/* ---------- Kindle ---------- */

export function KindleSection({
  config,
  save,
  saved,
  kindleConnected,
  kindleStatus,
  onNavigate
}: {
  config: AppConfig;
  save: Save;
  saved: () => void;
  kindleConnected: boolean;
  kindleStatus: KindleDeviceStatus | null;
  onNavigate: Navigate;
}) {
  const formatId = useId();
  const azw3 = config.defaultFormats.includes("AZW3");
  const wirelessSupported = Boolean(kindleStatus?.wirelessSupported);
  const [integrations, updateIntegrations] = useIntegrationPreferences();
  const connectedLabel = kindleStatus?.transport === "mtp" ? settingsStrings.kindleConnectedMtp : settingsStrings.kindleConnectedDisk;
  return (
    <>
      <SettingsGroup {...settingsStrings.groups.kindle}>
        <SettingsRow label={settingsStrings.kindleStatus} description={kindleConnected ? undefined : settingsStrings.kindleStatusHint} testId="kindle-status">
          <div className="settings-inline settings-inline--end">
            <Badge tone={kindleConnected ? "success" : "neutral"}>
              {kindleConnected ? connectedLabel : settingsStrings.kindleDisconnected}
            </Badge>
            <Button variant="ghost" size="sm" iconRight={<ArrowRight />} onClick={() => onNavigate("kindle")}>
              {settingsStrings.openKindle}
            </Button>
          </div>
        </SettingsRow>
        {wirelessSupported ? (
          <>
            <SettingsRow label={settingsStrings.sendToKindleApp} description={settingsStrings.sendToKindleAppHint} testId="send-to-kindle-status">
              <div className="settings-inline settings-inline--end">
                <Badge tone={kindleStatus?.wirelessAvailable ? "success" : "neutral"}>
                  {kindleStatus?.wirelessAvailable ? settingsStrings.sendToKindleInstalled : settingsStrings.sendToKindleMissing}
                </Badge>
                {kindleStatus?.wirelessAvailable ? null : (
                  <Button variant="ghost" size="sm" icon={<Download />} onClick={() => void openExternal(SEND_TO_KINDLE_URL)}>
                    {settingsStrings.sendToKindleDownload}
                  </Button>
                )}
              </div>
            </SettingsRow>
            <SettingsRow label={settingsStrings.kindleMethod} description={settingsStrings.kindleMethodHint}>
              <SegmentedControl<KindleSendMethod>
                aria-label={settingsStrings.kindleMethod}
                value={integrations.kindleMethod}
                onChange={(kindleMethod) => {
                  updateIntegrations({ kindleMethod });
                  saved();
                }}
                options={[
                  { value: "usb", label: settingsStrings.kindleMethodUsb, icon: <Usb /> },
                  { value: "wireless", label: settingsStrings.kindleMethodWireless, icon: <Wifi /> }
                ]}
              />
            </SettingsRow>
          </>
        ) : null}
        <SettingsRow label={settingsStrings.kindleFormat} labelId={`${formatId}-label`} htmlFor={formatId} description={settingsStrings.kindleFormatHint}>
          <SelectField
            id={formatId}
            label={settingsStrings.kindleFormat}
            hideLabel
            aria-labelledby={`${formatId}-label`}
            options={[{ value: "AZW3", label: settingsStrings.kindleFormatAzw3 }]}
            value="AZW3"
            disabled
            onChange={() => undefined}
          />
        </SettingsRow>
        <SwitchRow
          label={settingsStrings.kindleAlwaysAzw3}
          description={settingsStrings.kindleAlwaysAzw3Hint}
          checked={azw3}
          onChange={(checked) => {
            if (checked === azw3) return;
            // Turning AZW3 off when it is the only format falls back to EPUB.
            const next = !checked && config.defaultFormats.length === 1 ? ["EPUB" as const] : toggleFormat(config.defaultFormats, "AZW3");
            save({ defaultFormats: next });
          }}
        />
      </SettingsGroup>
      {wirelessSupported ? (
        <ICloudGroup
          folder={integrations.icloudFolder}
          onFolderChange={(icloudFolder) => {
            updateIntegrations({ icloudFolder });
            saved();
          }}
        />
      ) : null}
    </>
  );
}

/** iCloud Drive (macOS): where "Salvar no iCloud" copies the EPUBs. */
function ICloudGroup({ folder, onFolderChange }: { folder: string; onFolderChange: (folder: string) => void }) {
  const folderId = useId();
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getICloudStatus()
      .then((status) => {
        if (!cancelled) setAvailable(Boolean(status?.available));
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const draft = useDraft(folder, () => null, (value) => onFolderChange(normalizeICloudFolder(value)));
  return (
    <SettingsGroup {...settingsStrings.groups.icloud}>
      <SettingsRow
        label={settingsStrings.icloudStatus}
        description={available === false ? settingsStrings.icloudOffHint : undefined}
        testId="icloud-status"
      >
        <Badge tone={available ? "success" : "neutral"}>
          {available === null ? settingsStrings.icloudChecking : available ? settingsStrings.icloudOn : settingsStrings.icloudOff}
        </Badge>
      </SettingsRow>
      <SettingsRow stacked label={settingsStrings.icloudFolder} labelId={`${folderId}-label`} htmlFor={folderId}>
        <TextField
          id={folderId}
          label={settingsStrings.icloudFolder}
          hideLabel
          aria-labelledby={`${folderId}-label`}
          spellCheck={false}
          leading={<Cloud />}
          value={draft.draft}
          placeholder={DEFAULT_ICLOUD_FOLDER}
          hint={settingsStrings.icloudFolderHint(normalizeICloudFolder(draft.draft))}
          onChange={(event) => draft.setDraft(event.target.value)}
          onBlur={() => void draft.flush()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              draft.flush();
            }
          }}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}

/* ---------- Áudio / Tradução ---------- */

export function AudioSection({
  config,
  save,
  saved,
  onNavigate,
  translation
}: {
  config: AppConfig;
  save: Save;
  saved: () => void;
  onNavigate: Navigate;
  translation: TranslationSettingsProps;
}) {

  return (
    <>
      <TranslationGroup {...translation} onNavigate={onNavigate} saved={saved} />
    </>
  );
}

/* ---------- Tradução (inside Áudio e tradução) ---------- */

export type TranslationSettingsProps = {
  account: TranslationAccountState;
  connecting: boolean;
  loggingOut: boolean;
  onConnect: () => void;
  onCancelConnect: () => void;
  onLogout: () => void;
};

function TranslationAccountRow({ account, connecting, loggingOut, onConnect, onCancelConnect, onLogout }: TranslationSettingsProps) {
  const ts = translationSettingsStrings;
  let badge: ReactNode;
  let action: ReactNode = null;
  if (account.status === "logged_in") {
    badge = <Badge tone="success">{account.email ?? translationStrings.accountConnected}</Badge>;
    action = <Button size="sm" variant="ghost" icon={<LogOut />} loading={loggingOut} onClick={onLogout}>{translationStrings.logout}</Button>;
  } else if (account.status === "logged_out") {
    badge = connecting
      ? <span className="settings-value settings-inline"><Spinner size="sm" />{translationStrings.connectWaiting}</span>
      : <Badge>{translationStrings.accountDisconnected}</Badge>;
    action = connecting
      ? <Button size="sm" variant="ghost" onClick={onCancelConnect}>{translationStrings.connectCancel}</Button>
      : <Button size="sm" variant="primary" onClick={onConnect}>{translationStrings.connectShort}</Button>;
  } else if (account.status === "unavailable") {
    badge = <Badge>{ts.accountUnavailable}</Badge>;
  } else if (account.status === "error") {
    badge = <Badge tone="danger">{ts.accountError}</Badge>;
  } else {
    badge = <span className="settings-value">{ts.accountLoading}</span>;
  }
  return (
    <SettingsRow label={ts.account} testId="translation-account-status">
      <div className="settings-inline settings-inline--end">
        {badge}
        {action}
      </div>
    </SettingsRow>
  );
}

function TranslationGroup({ onNavigate, saved, ...account }: TranslationSettingsProps & { onNavigate: Navigate; saved: () => void }) {
  const ts = translationSettingsStrings;
  const [prefs, updatePrefs] = useTranslationPreferences();
  const modelId = useId();
  const effortId = useId();
  const languageId = useId();
  const update = (patch: Parameters<typeof updatePrefs>[0]) => {
    updatePrefs(patch);
    saved();
  };

  return (
    <SettingsGroup title={settingsStrings.groups.translation.title} description={ts.groupDescription}>
      <TranslationAccountRow {...account} />
      <SettingsRow label={ts.defaultModel} labelId={`${modelId}-label`} htmlFor={modelId} description={ts.defaultModelHint}>
        <SelectField<TranslationModelId>
          id={modelId}
          label={ts.defaultModel}
          hideLabel
          aria-labelledby={`${modelId}-label`}
          options={translationModels.map((model) => ({ value: model, label: `${modelLabel(model)} (${model})` }))}
          value={prefs.model}
          onChange={(event) => update({ model: event.target.value as TranslationModelId })}
        />
      </SettingsRow>
      <SettingsRow label={ts.effort} labelId={`${effortId}-label`} htmlFor={effortId} description={ts.effortHint}>
        <SelectField<TranslationEffort>
          id={effortId}
          label={ts.effort}
          hideLabel
          aria-labelledby={`${effortId}-label`}
          options={[
            { value: "none", label: translationStrings.effortLabels.none },
            { value: "low", label: translationStrings.effortLabels.low }
          ]}
          value={prefs.effort}
          onChange={(event) => update({ effort: event.target.value as TranslationEffort })}
        />
      </SettingsRow>
      <SettingsRow label={ts.workers} description={ts.workersHint}>
        <SegmentedControl<"1" | "2" | "3">
          aria-label={ts.workers}
          value={String(prefs.workers) as "1" | "2" | "3"}
          onChange={(value) => update({ workers: Number(value) })}
          options={Array.from({ length: TRANSLATION_WORKERS_MAX }, (_, index) => {
            const value = String(index + 1) as "1" | "2" | "3";
            return { value, label: value };
          })}
        />
      </SettingsRow>
      <SettingsRow label={ts.targetLanguage} labelId={`${languageId}-label`} htmlFor={languageId} description={ts.targetLanguageHint}>
        <SelectField
          id={languageId}
          label={ts.targetLanguage}
          hideLabel
          aria-labelledby={`${languageId}-label`}
          options={[{ value: "pt-BR", label: translationStrings.targetLanguage }]}
          value="pt-BR"
          disabled
          onChange={() => undefined}
        />
      </SettingsRow>
      <div className="settings-row settings-row--link">
        <Button variant="ghost" size="sm" icon={<Languages />} iconRight={<ArrowRight />} onClick={() => onNavigate("translation")}>
          {settingsStrings.openTranslation}
        </Button>
      </div>
    </SettingsGroup>
  );
}

/* ---------- Sobre ---------- */

export function AboutSection({ onOpenOnboarding }: { onOpenOnboarding: () => void }) {
  const [version, setVersion] = useState(fallbackAppVersion);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let alive = true;
    void getAppVersion().then((value) => {
      if (alive) setVersion(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <div className="settings-about">
        <img className="settings-about__logo" src="/icons/oghma-icon.svg" alt="" draggable={false} />
        <div className="settings-about__text">
          <div className="settings-about__title">
            <strong>{settingsStrings.appName}</strong>
            <Badge tone="accent" data-testid="app-version">{settingsStrings.version(version)}</Badge>
          </div>
          <p>{settingsStrings.tagline}</p>
          <div className="settings-about__links">
            <Button size="sm" icon={<Github />} onClick={() => void openExternal(settingsLinks.repo)}>
              {settingsStrings.github}
            </Button>
            <Button size="sm" variant="ghost" icon={<ExternalLink />} onClick={() => void openExternal(settingsLinks.issues)}>
              {settingsStrings.reportIssue}
            </Button>
          </div>
        </div>
      </div>

      <SettingsGroup {...settingsStrings.groups.setup}>
        <SettingsRow label={settingsStrings.setupWizard} description={settingsStrings.rerunSetupHint}>
          <Button icon={<RotateCcw />} onClick={() => setConfirming(true)}>
            {settingsStrings.rerunSetup}
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <ConfirmationModal
        open={confirming}
        title={settingsStrings.rerunSetupConfirmTitle}
        description={settingsStrings.rerunSetupConfirmDescription}
        confirmLabel={settingsStrings.rerunSetupConfirm}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onOpenOnboarding();
        }}
      />
    </>
  );
}
