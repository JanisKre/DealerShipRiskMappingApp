import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useUpdateStatus } from "./AppSupportCard";

/**
 * Announces a new release once per version (and a downloaded one once) with
 * a toast that leads to the update controls in the settings.
 */
export function UpdateNotifier(): null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const status = useUpdateStatus();
  const announced = useRef(new Set<string>());

  useEffect(() => {
    if (!status?.latestVersion) return;
    if (status.state !== "available" && status.state !== "ready") return;
    const key = `${status.state}:${status.latestVersion}`;
    if (announced.current.has(key)) return;
    announced.current.add(key);
    toast.info(
      status.state === "ready"
        ? t("settings.support.update.ready", { version: status.latestVersion })
        : t("settings.support.update.toast", { version: status.latestVersion }),
      {
        duration: 15_000,
        action: {
          label: t("settings.support.update.toastAction"),
          onClick: () => navigate("/settings?section=general"),
        },
      },
    );
  }, [status, t, navigate]);

  return null;
}
