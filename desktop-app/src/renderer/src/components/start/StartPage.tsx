import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { DealershipInput } from "@shared/types";
import { useAppStore } from "@renderer/store/appStore";
import { useConversationStore } from "@renderer/store/conversationStore";
import { useDashboardStore } from "@renderer/store/dashboardStore";
import { ExecutiveSummary } from "@renderer/components/ai/ExecutiveSummary";
import { ConversationSidebar } from "@renderer/components/chat/ConversationSidebar";
import { MessageBubble } from "@renderer/components/chat/MessageBubble";
import { useChat } from "@renderer/components/chat/useChat";
import { Omnibox, type PlacePick } from "@renderer/components/upload/Omnibox";

/**
 * Unified landing page (route `/`): conversation history on the left, a
 * single search field (Omnibox) on the right that accepts addresses,
 * CSV/Excel imports, and AI questions. Addresses and imports are added to
 * the portfolio immediately and the app jumps to the map, where the analysis
 * runs in the background. Questions are answered inline in the active chat
 * thread.
 */
export function StartPage(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addAndAnalyze = useAppStore((s) => s.addAndAnalyze);
  const analyzing = useAppStore((s) => s.analyzing);
  const hasData = useAppStore((s) => s.dealerships.length > 0);
  const lastImportReport = useAppStore((s) => s.lastImportReport);
  const setImportReport = useAppStore((s) => s.setImportReport);
  const loadList = useConversationStore((s) => s.loadList);
  const generateDashboard = useDashboardStore((s) => s.generate);
  const dashboardGenerating = useDashboardStore((s) => s.generating);
  const { messages, activeId, streamingText, streaming, error, send } =
    useChat();

  const scrollRef = useRef<HTMLDivElement>(null);

  // Load the persisted conversation list on mount.
  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Scroll to the end on new messages / an active stream.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streamingText]);

  /** Add new locations, jump to the map, and analyze in the background. */
  async function addRows(incoming: DealershipInput[]): Promise<void> {
    navigate("/map");
    const skipped = await addAndAnalyze(incoming);
    if (skipped > 0) {
      toast.info(t("start.duplicatesSkipped", { count: skipped }));
    }
  }

  function onPickAddress(p: PlacePick): void {
    void addRows([
      {
        id: crypto.randomUUID(),
        name: deriveName(p.label),
        address: p.label,
        lat: p.lat,
        lon: p.lon,
      },
    ]);
  }

  /** Dashboard prompt: jump to the AI dashboard page and generate there. */
  function onGenerateDashboard(prompt: string): void {
    navigate("/ai-dashboard");
    void generateDashboard(prompt, useAppStore.getState().dealerships);
  }

  /** Read a CSV/TSV/Excel file and import it as location rows. */
  async function handleUploadFile(file: File): Promise<void> {
    const isXlsx = /\.xlsx$/i.test(file.name);
    const result = isXlsx
      ? await window.api.parseXlsx(
          arrayBufferToBase64(await file.arrayBuffer()),
        )
      : await window.api.parseCsv(await file.text());
    setImportReport(result.report);
    await addRows(result.rows);
  }

  const chatEmpty = messages.length === 0 && !streaming;
  const pageEmpty = chatEmpty && !hasData;

  return (
    <div className="flex h-full">
      <ConversationSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {pageEmpty ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-muted">
                <Sparkles className="size-7 text-primary" />
              </div>
              <h2 className="text-2xl font-semibold">
                {t("start.emptyTitle")}
              </h2>
              <p className="max-w-md text-sm text-muted-foreground">
                {t("start.emptyDescription")}
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-4xl space-y-6 p-8">
              {hasData && <ExecutiveSummary />}

              {lastImportReport && (
                <ImportQualityNotice report={lastImportReport} />
              )}

              {(messages.length > 0 || streaming) && (
                <div className="space-y-4 border-t pt-6">
                  {messages.map((m, i) => (
                    <MessageBubble
                      key={`${activeId}-${i}-${m.role}`}
                      role={m.role}
                      content={m.content}
                    />
                  ))}
                  {streaming && (
                    <MessageBubble
                      role="assistant"
                      content={streamingText}
                      pending
                    />
                  )}
                  {error && (
                    <p className="text-sm text-destructive">
                      {t("ui.error", { error })}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t bg-background">
          <div className="mx-auto max-w-4xl space-y-2 px-8 py-4">
            <Omnibox
              onPickAddress={onPickAddress}
              onAskQuestion={send}
              onGenerateDashboard={onGenerateDashboard}
              onUploadFile={handleUploadFile}
              disabled={analyzing || streaming || dashboardGenerating}
            />
            <p className="px-1 text-xs text-muted-foreground">
              {t("start.inputHint")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImportQualityNotice({
  report,
}: {
  report: NonNullable<
    ReturnType<typeof useAppStore.getState>["lastImportReport"]
  >;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="font-medium">
        {t("start.importQuality")} · {report.format.toUpperCase()}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
        <span>
          {report.importedRows} {t("start.imported")}
        </span>
        <span>
          {report.skippedRows} {t("start.skipped")}
        </span>
        <span>
          {report.duplicateRows} {t("start.duplicates")}
        </span>
        {report.issues.length > 0 && (
          <span>
            {report.issues.length} {t("start.issues")}
          </span>
        )}
      </div>
      {report.warnings.map((warning) => (
        <div
          key={warning}
          className="mt-2 text-xs text-amber-700 dark:text-amber-300"
        >
          {warning}
        </div>
      ))}
    </div>
  );
}

/** Derive a location name from an address: first comma segment, else the label. */
function deriveName(label: string): string {
  const first = label.split(",")[0]?.trim();
  return first || label;
}

/** ArrayBuffer -> base64 (for XLSX transport over IPC). */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
