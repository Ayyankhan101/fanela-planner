import { notFound } from "next/navigation";
import { getJob } from "@/lib/services/jobs";
import { getArtwork } from "@/lib/services/artwork";
import { getSessionUser } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/access";
import { JobHeaderForm } from "./header-form";
import { CancelJobButton } from "./panels/cancel-button";
import { LinesPanel } from "./panels/lines-panel";
import { StagesPanel } from "./panels/stages-panel";
import { ScreensPanel } from "./panels/screens-panel";
import { SwatchPanel } from "./panels/swatch-panel";
import { ArtworkPanel } from "./panels/artwork-panel";
import { StockPanel } from "./panels/stock-panel";
import { DispatchPanel } from "./panels/dispatch-panel";

type Rec = Record<string, unknown>;

const GATE_LABEL: Record<string, string> = { stock: "Stock", screens: "Screens", swatch: "Swatch" };

function ReadinessStrip({ readiness }: { readiness: Rec | null }) {
  if (!readiness) return null;
  const gates = (readiness.gates as Record<string, { active: boolean; pass: boolean }>) ?? {};
  const colour = String(readiness.colour);
  const dot =
    colour === "green"
      ? "bg-emerald-500"
      : colour === "amber"
        ? "bg-amber-500"
        : "bg-zinc-300 dark:bg-zinc-700";
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm dark:border-zinc-800 dark:bg-zinc-950">
      <span className="flex items-center gap-2 font-medium">
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
        Readiness {String(readiness.passedGates)}/{String(readiness.activeGates)}
      </span>
      {Object.entries(gates).map(([k, g]) => (
        <span
          key={k}
          className={`rounded-full px-2 py-0.5 text-xs ${
            !g.active
              ? "bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600"
              : g.pass
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
          }`}
        >
          {GATE_LABEL[k] ?? k}: {!g.active ? "n/a" : g.pass ? "pass" : "waiting"}
        </span>
      ))}
    </div>
  );
}

export default async function JobDetailPage({ params }: PageProps<"/jobs/[id]">) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return null;
  const job = await getJob(id, user);
  if (!job) notFound();
  const artwork = await getArtwork(id, user);

  const canEdit = hasPermission(user, "jobs.edit");
  const canStage = hasPermission(user, "stage.update");
  const canArtwork = hasPermission(user, "artwork.approve");
  const canSwatchCreate = hasPermission(user, "swatch.create");
  const canSwatchDecide = hasPermission(user, "swatch.decide");
  const canStock = hasPermission(user, "stock.edit");
  const canDispatch = hasPermission(user, "dispatch.edit");
  const canPlan = hasPermission(user, "jobs.plan_dispatch") || canDispatch;
  const canCancel = user.roles.includes("admin") || user.roles.includes("ops");

  const stages = job.stages as Rec[];
  const lines = job.lines as Rec[];
  const attempts = job.attempts as Rec[];
  const shipments = job.shipments as Rec[];
  const screen = job.screen as Rec | null;
  const swatchReq = job.swatchRequirement as Rec | null;
  const readiness = job.readiness as Rec | null;
  const stock = job.stock as Rec | null;
  const status = String(job.status);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {String(job.job_number)}
          </h1>
          <p className="text-sm text-zinc-500">
            {String(job.customer_name)} {job.po ? `· PO ${String(job.po)}` : ""}{" "}
            {job.print_name ? `· ${String(job.print_name)}` : ""}
          </p>
        </div>
        <div className="flex items-start gap-4 text-right text-sm">
          <div>
            <div className="text-zinc-500">Status</div>
            <div className="font-medium">{status}</div>
            {job.archived ? <div className="text-xs text-zinc-400">archived</div> : null}
          </div>
          {canCancel && <CancelJobButton jobId={String(job.id)} status={status} />}
        </div>
      </div>

      <ReadinessStrip readiness={readiness} />

      {canEdit && (
        <JobHeaderForm job={{ ...job, id: String(job.id), version: Number(job.version) }} />
      )}

      <LinesPanel jobId={String(job.id)} lines={lines} canEdit={canEdit} />

      <StagesPanel jobId={String(job.id)} stages={stages} canStage={canStage} />

      <div className="grid gap-6 lg:grid-cols-2">
        <ScreensPanel jobId={String(job.id)} screen={screen} canStage={canStage} />
        <SwatchPanel
          jobId={String(job.id)}
          requirement={swatchReq}
          attempts={attempts}
          canCreate={canSwatchCreate}
          canDecide={canSwatchDecide}
        />
      </div>

      <ArtworkPanel jobId={String(job.id)} artwork={artwork} canArtwork={canArtwork} />

      <StockPanel jobId={String(job.id)} stock={stock} canStock={canStock} />

      <DispatchPanel
        jobId={String(job.id)}
        jobVersion={Number(job.version)}
        plan={{ method: (job.dispatch_method as string | null) ?? null, address: (job.dispatch_address as string | null) ?? null }}
        shipments={shipments}
        canPlan={canPlan}
        canDispatch={canDispatch}
      />
    </div>
  );
}
