import { BookOpenText, Check, Download, Search, Send, Tablet, Usb, Wifi, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { AppView } from "../../app/NavigationContext";
import type { DownloadJob, KindleSendMethod, LibraryItem } from "../../core/types";
import { kindlePageStrings as strings } from "../../strings/kindle";
import { libraryStrings } from "../../strings/library";
import { Badge, Button, Chip, Cover, EmptyState, IconButton, PathControl, ProgressBar, SegmentedControl, SelectionMark, SortableList, TextField, cx } from "../../ui";
import { matchesQuery } from "../library/libraryModel";
import type { LibraryController } from "../library/useLibraryController";
import { readIntegrationPreferences } from "../settings/preferences";
import "./kindle.css";

type KindleViewProps = {
  library: LibraryController;
  activeJob: DownloadJob | null;
  navigate: (view: AppView) => void;
};

type ItemPhase = { kind: "ready" } | { kind: "waiting" } | { kind: "active"; percent: number } | { kind: "done" };

function DeviceHero({ library }: { library: LibraryController }) {
  const connected = library.kindleConnected;
  const status = library.kindleStatus;
  const name = connected ? status?.deviceName || strings.genericDevice : strings.noDevice;
  const wirelessSupported = library.kindleWirelessSupported;
  const description = connected
    ? strings.connectedDescription
    : wirelessSupported ? strings.disconnectedWirelessDescription : strings.disconnectedDescription;
  return (
    <section className={cx("kindle-hero", connected && "kindle-hero--connected")} aria-label={strings.statusLabel} data-testid="kindle-hero">
      <span className="kindle-hero__icon" aria-hidden="true">
        {connected ? <Tablet /> : <Usb />}
      </span>
      <div className="kindle-hero__text">
        <div className="kindle-hero__title-row">
          <h2 className="kindle-hero__title">{name}</h2>
          <Badge tone={connected ? "success" : "neutral"} data-testid={connected ? "kindle-connected" : "kindle-disconnected"}>
            <span className={cx("kindle-dot", connected && "kindle-dot--on")} aria-hidden="true" />
            {connected ? strings.connected : strings.disconnected}
          </Badge>
        </div>
        <p className="kindle-hero__description">{description}</p>
        {connected || wirelessSupported ? (
          <dl className="kindle-hero__facts">
            {connected ? (
              <div className="kindle-hero__fact">
                <dt>{strings.cableLabel}</dt>
                <dd>{status?.transport === "mtp" ? strings.cableMtp : strings.cableDisk}</dd>
              </div>
            ) : null}
            {wirelessSupported ? (
              <div className="kindle-hero__fact" data-testid="kindle-wireless-status">
                <dt>{strings.wirelessLabel}</dt>
                <dd>
                  {status?.wirelessAvailable ? strings.wirelessInstalled : (
                    <Button variant="ghost" size="sm" icon={<Download />} onClick={library.offerSendToKindleInstall}>
                      {strings.wirelessInstall}
                    </Button>
                  )}
                </dd>
              </div>
            ) : null}
            {status?.mountPath ? (
              <div className="kindle-hero__fact">
                <dt>{strings.mountPath}</dt>
                <dd><PathControl path={status.mountPath} segments={2} /></dd>
              </div>
            ) : null}
            {connected ? (
              <div className="kindle-hero__fact">
                <dt>{strings.targetFormat}</dt>
                <dd>{status?.targetFormat ?? "AZW3"}</dd>
              </div>
            ) : null}
            {connected && status?.converterAvailable === false ? (
              <div className="kindle-hero__fact">
                <dd><Badge tone="warning">{strings.converterMissing}</Badge></dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>
    </section>
  );
}

function ConnectTips({ onOpenLibrary }: { onOpenLibrary: () => void }) {
  return (
    <section className="kindle-tips" aria-labelledby="kindle-tips-title">
      <h3 id="kindle-tips-title" className="kindle-section-title">{strings.tipsHeading}</h3>
      <ol className="kindle-tips__list">
        {strings.tips.map((tip, index) => (
          <li key={tip} className="kindle-tips__item">
            <span className="kindle-tips__step" aria-hidden="true">{index + 1}</span>
            <span>{tip}</span>
          </li>
        ))}
      </ol>
      <Button variant="outline" icon={<BookOpenText />} onClick={onOpenLibrary}>{strings.openLibrary}</Button>
    </section>
  );
}

/** Kindle page: device status and, while connected, the "Enviar ao Kindle" flow. */
export function KindleView({ library, activeJob, navigate }: KindleViewProps) {
  const [query, setQuery] = useState("");
  const wirelessSupported = library.kindleWirelessSupported;
  const [method, setMethod] = useState<KindleSendMethod>(() =>
    wirelessSupported ? readIntegrationPreferences().kindleMethod : "usb");
  // Without the cable on macOS, Wi-Fi is the only way; the choice comes back when it is plugged in.
  const sendMethod: KindleSendMethod = wirelessSupported && (method === "wireless" || !library.kindleConnected) ? "wireless" : "usb";
  const conversion = library.conversion;
  const running = conversion.converterRunning;
  const sendingToKindle = running && library.conversionTarget === "kindle";

  const selected = useMemo(
    () => library.selectedLibraryIds
      .map((id) => library.downloaded.find((item) => item.id === id))
      .filter((item): item is LibraryItem => Boolean(item)),
    [library.downloaded, library.selectedLibraryIds]
  );
  const selectedIds = new Set(library.selectedLibraryIds);
  const visible = library.downloaded.filter((item) => matchesQuery(item, query));

  const runIndex = sendingToKindle && conversion.converterCurrentItemId
    ? library.conversionIds.indexOf(conversion.converterCurrentItemId)
    : -1;
  const phaseOf = (item: LibraryItem): ItemPhase => {
    if (!sendingToKindle) return { kind: "ready" };
    const index = library.conversionIds.indexOf(item.id);
    if (index === -1 || runIndex === -1) return { kind: "ready" };
    if (index < runIndex) return { kind: "done" };
    if (index > runIndex) return { kind: "waiting" };
    const job = activeJob && activeJob.kind === "convert" && activeJob.novelId === (item.novelId ?? item.id) ? activeJob : null;
    return { kind: "active", percent: job?.progress.percent ?? 0 };
  };

  const phaseText = (item: LibraryItem, phase: ItemPhase) => {
    if (phase.kind === "done") return strings.itemDone;
    if (phase.kind === "waiting") return strings.itemWaiting;
    if (phase.kind === "active") return phase.percent > 0 ? strings.itemPreparingPercent(phase.percent) : strings.itemPreparing;
    return strings.itemReady(item.sizeMb);
  };

  const selectVisible = () => {
    const next = [...library.selectedLibraryIds];
    for (const item of visible) if (!next.includes(item.id)) next.push(item.id);
    library.setSelectedLibraryIds(next);
  };

  const send = () => {
    const ids = selected.map((item) => item.id);
    if (sendMethod === "wireless") library.sendToKindleWireless(ids);
    else library.sendToKindle(ids);
  };

  if (!library.kindleConnected && !wirelessSupported) {
    return (
      <div className="o-page kindle-page" data-testid="kindle-page">
        <DeviceHero library={library} />
        <ConnectTips onOpenLibrary={() => navigate("library")} />
      </div>
    );
  }

  return (
    <div className="o-page kindle-page" data-testid="kindle-page">
      <DeviceHero library={library} />

      <div className="kindle-send">
        <section className="kindle-picker" aria-labelledby="kindle-picker-title">
          <header className="kindle-picker__header">
            <div className="kindle-picker__heading">
              <h3 id="kindle-picker-title" className="kindle-section-title">{strings.pickHeading}</h3>
              <p className="kindle-muted">{strings.pickDescription}</p>
            </div>
            <div className="kindle-picker__tools">
              <TextField
                label={strings.searchLabel}
                hideLabel
                type="search"
                placeholder={strings.searchPlaceholder}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                leading={<Search aria-hidden="true" />}
                fieldClassName="kindle-picker__search"
              />
              <Button variant="ghost" size="sm" onClick={selectVisible} disabled={running || visible.length === 0}>
                {strings.selectAllVisible}
              </Button>
            </div>
          </header>

          {library.downloaded.length === 0 ? (
            <EmptyState
              icon={<BookOpenText />}
              title={strings.noBooksTitle}
              description={strings.noBooksDescription}
              action={<Button variant="primary" onClick={() => navigate("discover")}>{strings.noBooksAction}</Button>}
            />
          ) : visible.length === 0 ? (
            <p className="kindle-muted kindle-picker__none">{strings.noMatch}</p>
          ) : (
            <ul className="kindle-books" aria-label={strings.pickHeading}>
              {visible.map((item) => {
                const checked = selectedIds.has(item.id);
                return (
                  <li key={item.id}>
                    <label className={cx("kindle-book", checked && "is-checked")} data-testid="kindle-book">
                      <input
                        type="checkbox"
                        className="kindle-book__input"
                        checked={checked}
                        disabled={running}
                        onChange={() => library.toggleLibrarySelect(item.id)}
                        aria-label={strings.selectBook(item.title)}
                      />
                      <span className="kindle-book__cover">
                        <Cover src={item.coverUrl} title={item.title} size="fill" sheen />
                        {checked ? <SelectionMark /> : null}
                      </span>
                      <span className="kindle-book__title" title={item.title}>{item.title}</span>
                      {/* Which edition this file is (source or translation): two of the same work look alike. */}
                      <span className="kindle-book__meta">
                        {[item.language ? libraryStrings.translationEdition(item.language.toUpperCase()) : item.sourceName, libraryStrings.size(item.sizeMb)]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="kindle-queue" aria-labelledby="kindle-queue-title" data-testid="kindle-queue">
          <header className="kindle-queue__header">
            <div>
              <h3 id="kindle-queue-title" className="kindle-section-title">{strings.sendHeading}</h3>
              <p className="kindle-muted">{strings.sendDescription}</p>
            </div>
            {selected.length > 0 ? <Badge tone="accent">{strings.selectedCount(selected.length)}</Badge> : null}
          </header>

          <div className="kindle-queue__format">
            {wirelessSupported ? (
              <>
                <span className="kindle-queue__label">{strings.methodLabel}</span>
                <SegmentedControl<KindleSendMethod>
                  aria-label={strings.methodLabel}
                  size="sm"
                  className="kindle-queue__method"
                  value={sendMethod}
                  onChange={setMethod}
                  options={[
                    { value: "usb", label: strings.methodUsb, icon: <Usb />, disabled: !library.kindleConnected || running },
                    { value: "wireless", label: strings.methodWireless, icon: <Wifi />, disabled: running }
                  ]}
                />
              </>
            ) : null}
            <span className="kindle-queue__label">{strings.formatLabel}</span>
            <div className="kindle-queue__chips" role="group" aria-label={strings.formatLabel}>
              <Chip selected icon={<Check />}>{sendMethod === "wireless" ? "EPUB" : "AZW3"}</Chip>
            </div>
            <span className="kindle-muted kindle-queue__hint">
              {sendMethod === "wireless"
                ? strings.wirelessHint
                : wirelessSupported && !library.kindleConnected ? strings.usbDisconnectedHint : strings.formatHint}
            </span>
          </div>

          {selected.length === 0 ? (
            <p className="kindle-queue__empty">{strings.emptyQueue}</p>
          ) : (
            <SortableList
              aria-label={strings.queueLabel}
              className="kindle-queue__list"
              items={selected}
              getId={(item) => item.id}
              getLabel={(item) => item.title}
              disabled={running}
              onReorder={(next) => library.setSelectedLibraryIds(next.map((item) => item.id))}
              renderItem={(item, { handleProps }) => {
                const phase = phaseOf(item);
                return (
                  <div
                    className={cx("kindle-queue-item", phase.kind === "active" && "is-active", phase.kind === "done" && "is-done")}
                    data-testid="library-queue-card"
                  >
                    <SortableList.Handle {...handleProps} />
                    <Cover src={item.coverUrl} title={item.title} size="sm" />
                    <div className="kindle-queue-item__body">
                      <strong className="kindle-queue-item__title">{item.title}</strong>
                      {phase.kind === "active" ? (
                        <ProgressBar
                          label={strings.itemProgress(item.title)}
                          value={phase.percent}
                          indeterminate={phase.percent <= 0}
                          size="sm"
                        />
                      ) : null}
                      <span className="kindle-queue-item__status">{phaseText(item, phase)}</span>
                    </div>
                    {phase.kind === "done" ? (
                      <span className="kindle-queue-item__done" aria-hidden="true"><Check /></span>
                    ) : (
                      <IconButton
                        label={strings.removeFromQueue(item.title)}
                        icon={<X />}
                        size="sm"
                        disabled={running}
                        onClick={() => library.removeSelectedLibraryItem(item.id)}
                      />
                    )}
                  </div>
                );
              }}
            />
          )}

          <footer className="kindle-queue__footer">
            {sendingToKindle ? (
              <ProgressBar label={strings.overallProgress} value={conversion.converterProgress} valueText={`${Math.round(conversion.converterProgress)}%`} />
            ) : null}
            <div className="kindle-queue__actions">
              {selected.length > 0 && !running ? (
                <Button variant="ghost" onClick={() => library.setSelectedLibraryIds([])}>{strings.clearSelection}</Button>
              ) : null}
              <Button
                variant="primary"
                icon={<Send />}
                loading={sendingToKindle}
                disabled={selected.length === 0 || running}
                onClick={send}
                data-testid="kindle-send"
              >
                {selected.length > 0 ? strings.send(selected.length) : strings.sendIdle}
              </Button>
            </div>
          </footer>
        </aside>
      </div>
    </div>
  );
}
