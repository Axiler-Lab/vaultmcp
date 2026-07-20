import { useId } from "react";

type StatItem = {
  label: string;
  value: number;
  hint?: string;
};

function maxOf(values: number[]) {
  return Math.max(1, ...values);
}

/** Horizontal comparison bars from live workspace counts (not time-series). */
export function WorkspaceStatsStrip({
  secrets,
  integrationsReady,
  integrationsTotal,
  members,
  tokens,
  auditAllowed,
  auditDenied,
}: {
  secrets: number;
  integrationsReady: number;
  integrationsTotal: number;
  members: number;
  tokens: number;
  auditAllowed?: number;
  auditDenied?: number;
}) {
  const items: StatItem[] = [
    { label: "Secrets", value: secrets },
    {
      label: "Integrations",
      value: integrationsReady,
      hint:
        integrationsTotal > 0
          ? `${integrationsReady}/${integrationsTotal} ready`
          : undefined,
    },
    { label: "Members", value: members },
    { label: "Tokens", value: tokens, hint: "Account-wide PATs" },
  ];
  const peak = maxOf(items.map((i) => i.value));
  const hasAudit =
    typeof auditAllowed === "number" &&
    typeof auditDenied === "number" &&
    auditAllowed + auditDenied > 0;
  const auditTotal = (auditAllowed ?? 0) + (auditDenied ?? 0);
  const allowPct = hasAudit ? Math.round(((auditAllowed ?? 0) / auditTotal) * 100) : 0;
  const readyPct =
    integrationsTotal > 0 ? Math.round((integrationsReady / integrationsTotal) * 100) : 0;

  return (
    <section className="ws-stats" aria-label="Workspace overview">
      <div className="ws-stats-head">
        <p className="section-label">Overview</p>
        <p className="ws-stats-note muted">Live counts from this workspace</p>
      </div>

      <div className="ws-stats-grid">
        <div className="ws-stats-bars" role="list">
          {items.map((item) => {
            const pct = Math.round((item.value / peak) * 100);
            return (
              <div key={item.label} className="ws-stat-row" role="listitem">
                <div className="ws-stat-meta">
                  <span className="ws-stat-name">{item.label}</span>
                  {item.hint ? <span className="ws-stat-hint">{item.hint}</span> : null}
                </div>
                <div
                  className="ws-stat-track"
                  role="img"
                  aria-label={`${item.label}: ${item.value}`}
                >
                  <div
                    className={`ws-stat-fill${item.value === 0 ? " is-empty" : ""}`}
                    style={{
                      width: item.value === 0 ? "0%" : `${Math.max(pct, 8)}%`,
                    }}
                  />
                </div>
                <strong className="mono ws-stat-value">{item.value}</strong>
              </div>
            );
          })}
        </div>

        <div className="ws-stats-side">
          <div className="ws-donut-card">
            <p className="ws-donut-label">Integrations ready</p>
            <div className="ws-donut-body">
              <IntegrationDonut
                ready={integrationsReady}
                total={Math.max(integrationsTotal, 1)}
                empty={integrationsTotal === 0}
              />
              <div className="ws-donut-copy">
                <p className="ws-donut-pct mono">
                  {integrationsTotal === 0 ? "—" : `${readyPct}%`}
                </p>
                <p className="ws-donut-caption">
                  {integrationsTotal === 0
                    ? "No templates installed yet"
                    : `${integrationsReady} of ${integrationsTotal} templates ready`}
                </p>
              </div>
            </div>
          </div>

          {hasAudit ? (
            <div className="ws-donut-card">
              <p className="ws-donut-label">Audit (loaded)</p>
              <AuditMiniBars allowed={auditAllowed ?? 0} denied={auditDenied ?? 0} />
              <p className="ws-donut-caption">
                {allowPct}% allowed · {auditTotal} events
              </p>
            </div>
          ) : (
            <div className="ws-donut-card ws-donut-empty">
              <p className="ws-donut-label">Audit activity</p>
              <div className="ws-donut-body">
                <IntegrationDonut ready={0} total={1} empty />
                <div className="ws-donut-copy">
                  <p className="ws-donut-pct mono">—</p>
                  <p className="ws-donut-caption">
                    No tool events yet. Connect an IDE and call a tool to populate this.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function IntegrationDonut({
  ready,
  total,
  empty = false,
}: {
  ready: number;
  total: number;
  empty?: boolean;
}) {
  const gradId = useId().replace(/:/g, "");
  const size = 84;
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = empty ? 0 : Math.min(1, ready / total);
  const dash = pct * c;

  return (
    <svg
      className="ws-donut"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={
        empty ? "No integrations installed" : `${ready} of ${total} integrations ready`
      }
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="var(--mcp-b)" />
        </linearGradient>
      </defs>
      <circle
        className="ws-donut-track"
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeDasharray={empty ? "4 6" : undefined}
      />
      {!empty && pct > 0 ? (
        <circle
          className="ws-donut-progress"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      ) : null}
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        className="ws-donut-text"
      >
        {empty ? "0" : `${ready}/${total}`}
      </text>
    </svg>
  );
}

function AuditMiniBars({ allowed, denied }: { allowed: number; denied: number }) {
  const peak = maxOf([allowed, denied]);
  const rows = [
    { label: "Allowed", value: allowed, className: "ws-audit-allowed", tone: "allowed" as const },
    { label: "Denied", value: denied, className: "ws-audit-denied", tone: "denied" as const },
  ];

  return (
    <div className="ws-audit-bars" role="img" aria-label={`Allowed ${allowed}, denied ${denied}`}>
      {rows.map((row) => (
        <div key={row.label} className="ws-audit-row">
          <span className="ws-audit-name">
            <span className={`ws-audit-dot ${row.tone}`} aria-hidden />
            {row.label}
          </span>
          <div className="ws-stat-track">
            <div
              className={`ws-stat-fill ${row.className}${row.value === 0 ? " is-empty" : ""}`}
              style={{
                width:
                  row.value === 0
                    ? "0%"
                    : `${Math.max(Math.round((row.value / peak) * 100), 8)}%`,
              }}
            />
          </div>
          <span className="mono ws-audit-n">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Compact 7-day activity bars from audit timestamps (real events only). */
export function AuditActivityChart({
  logs,
}: {
  logs: Array<{ createdAt: string; allowed: boolean }>;
}) {
  const days = last7DaysBuckets(logs);
  const peak = maxOf(days.map((d) => d.total));
  const chartH = 72;

  const plot = (
    <div className="ws-activity-plot" aria-hidden={logs.length === 0}>
      {days.map((d) => {
        const h = d.total === 0 ? 3 : Math.max(12, Math.round((d.total / peak) * chartH));
        return (
          <div key={d.key} className="ws-activity-col">
            <div className="ws-activity-bar-wrap">
              <div
                className={`ws-activity-bar${d.total === 0 ? " is-empty" : ""}`}
                style={{ height: h }}
                title={`${d.label}: ${d.total} events (${d.allowed} allowed, ${d.denied} denied)`}
              >
                {d.allowed > 0 && (
                  <div
                    className="ws-activity-seg allowed"
                    style={{ flexGrow: d.allowed }}
                  />
                )}
                {d.denied > 0 && (
                  <div
                    className="ws-activity-seg denied"
                    style={{ flexGrow: d.denied }}
                  />
                )}
              </div>
            </div>
            <span className="ws-activity-day">{d.short}</span>
          </div>
        );
      })}
    </div>
  );

  if (logs.length === 0) {
    return (
      <div className="ws-activity-empty">
        {plot}
        <p className="ws-activity-empty-msg">
          No audit events yet. Once tools run, daily allowed/denied counts appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="ws-activity" aria-label="Audit activity last 7 days">
      {plot}
      <div className="ws-activity-legend">
        <span>Last 7 days</span>
        <span className="ws-activity-legend-item">
          <span className="ws-audit-dot allowed" aria-hidden />
          Allowed
        </span>
        <span className="ws-activity-legend-item">
          <span className="ws-audit-dot denied" aria-hidden />
          Denied
        </span>
      </div>
    </div>
  );
}

function last7DaysBuckets(logs: Array<{ createdAt: string; allowed: boolean }>) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - i));
    const key = d.toISOString().slice(0, 10);
    return {
      key,
      label: d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
      short: d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2),
      allowed: 0,
      denied: 0,
      total: 0,
    };
  });
  const byKey = new Map(days.map((d) => [d.key, d]));
  for (const log of logs) {
    const key = new Date(log.createdAt).toISOString().slice(0, 10);
    const bucket = byKey.get(key);
    if (!bucket) continue;
    if (log.allowed) bucket.allowed += 1;
    else bucket.denied += 1;
    bucket.total += 1;
  }
  return days;
}
