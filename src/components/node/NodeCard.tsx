这里是调整后的代码。

### 修改思路说明

1. **重构页脚布局**：将“剩余流量（含进度条）”作为一个独立区块，放置在第一栏（“到期”和“在线”状态）的**正上方**。
2. **引入进度条组件**：直接复用你项目中已有的 `<MetricBar />` 组件来渲染流量进度条，保持 UI 风格与上方的 CPU、内存、磁盘等指标完全一致。
3. **自适应色彩控制**：
* 当流量无限时，进度条满格并呈现绿色 (`--status-success`)。
* 当剩余流量充足（>20%）时，呈现正常的资源色 (`--progress-disk` 或自定义色)。
* 当流量紧张（≤20%）时，自动切为警告色 (`--status-offline`)。



### 调整后的完整代码

```tsx
import { memo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Cpu,
  Gauge,
  MemoryStick,
  HardDrive,
  Globe,
  ArrowDown,
  ArrowUp,
  Clock3,
  Unplug,
  Calendar,
  RefreshCw,
  ExternalLink,
  Power,
} from "lucide-react";
import { useNode, useNodeTrafficTrend } from "@/hooks/useNode";
import { usePingMini, usePingMiniBuckets } from "@/hooks/usePingMini";
import { usePreferences } from "@/hooks/usePreferences";
import {
  formatBytes,
  formatExpireDays,
  formatOfflineDuration,
  formatTrafficRate,
  formatUptimeDays,
  parseTags,
} from "@/utils/format";
import { getExpireTextColor } from "@/utils/expireStatus";
import {
  latencyHeatColor,
  lossHeatColor,
} from "@/utils/metricTone";
import { Flag } from "@/components/ui/Flag";
import { MetricBar } from "./MetricBar";
import { MiniBars } from "./MiniBars";
import { QualityBars } from "./QualityBars";
import { CanvasStrip, resolveCssColor } from "./CanvasStrip";
import { clsx } from "clsx";
import type { PingOverviewBucket, TrafficTrendSample } from "@/types/komari";
import type { TrafficRateDisplay } from "@/utils/format";

function buildSubtitle(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

function formatBucketWindow(bucket: PingOverviewBucket | null) {
  if (!bucket || bucket.startAt == null || bucket.endAt == null) {
    return null;
  }
  const start = new Date(bucket.startAt);
  const end = new Date(bucket.endAt);
  return `${start.getHours().toString().padStart(2, "0")}:${start
    .getMinutes()
    .toString()
    .padStart(2, "0")} - ${end.getHours().toString().padStart(2, "0")}:${end
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
}

function formatLatencyBucketSummary(bucket: PingOverviewBucket | null) {
  if (!bucket) return "—";
  if (bucket.value != null) {
    return `${bucket.value.toFixed(1)} ms`;
  }
  return bucket.total > 0 ? "失败" : "无样本";
}

function formatLossBucketSummary(bucket: PingOverviewBucket | null) {
  if (!bucket) return "—";
  if ((bucket.total ?? 0) <= 0 || bucket.loss == null) {
    return "无样本";
  }
  return `${bucket.loss.toFixed(1)}% ${bucket.lost}/${bucket.total}`;
}

/**
 * 配合原生数据结构优化的流量计算函数
 */
function getTrafficInfo(node: any) {
  const limitBytes = Number(node.traffic_limit || 0);
  
  if (limitBytes <= 0) {
    return { text: "无限", percent: 100, isInfinite: true, hasConfig: true };
  }

  let usedBytes = 0;
  if (node.traffic_limit_type === "sum") {
    usedBytes = (node.trafficUp || 0) + (node.trafficDown || 0);
  } else {
    usedBytes = node.trafficUp || 0;
  }

  const remainingBytes = Math.max(0, limitBytes - usedBytes);
  const percent = Math.round((remainingBytes / limitBytes) * 100);

  let text = "";
  if (remainingBytes >= 1024 * 1024 * 1024 * 1024) {
    text = `${(remainingBytes / (1024 * 1024 * 1024 * 1024)).toFixed(1)} TB`;
  } else {
    text = `${(remainingBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  return { text, percent, isInfinite: false, hasConfig: true };
}

export const NodeCard = memo(function NodeCard({
  uuid,
}: {
  uuid: string;
}) {
  const { resolvedAppearance } = usePreferences();
  const node = useNode(uuid);
  const trafficTrend = useNodeTrafficTrend(uuid);
  const ping = usePingMini(uuid);
  const pingBuckets = usePingMiniBuckets(ping);
  const [hoveredLatencyIndex, setHoveredLatencyIndex] = useState<number | null>(null);
  const [hoveredLossIndex, setHoveredLossIndex] = useState<number | null>(null);
  const hoveredLatencyBucket =
    hoveredLatencyIndex != null ? (pingBuckets[hoveredLatencyIndex] ?? null) : null;
  const hoveredLossBucket =
    hoveredLossIndex != null ? (pingBuckets[hoveredLossIndex] ?? null) : null;
  const latencyHoverTime = formatBucketWindow(hoveredLatencyBucket);
  const lossHoverTime = formatBucketWindow(hoveredLossBucket);

  if (!node) {
    return (
      <div
        className="server-card animate-pulse"
        style={{ minHeight: 438 }}
        aria-busy
      />
    );
  }

  const tags = parseTags(node.tags);
  const footerTags =
    tags.length > 0
      ? tags
      : node.group
        ? [{ label: node.group, color: "gray" }]
        : [];
  const expire = formatExpireDays(node.expired_at);
  const uptime = formatUptimeDays(node.uptime);

  // 直接调用原生高级字段解析流量
  const trafficInfo = getTrafficInfo(node);

  const subtitle =
    buildSubtitle([node.group, node.public_remark]) ||
    buildSubtitle([node.os, node.arch, node.virtualization]);

  const latencyColor = latencyHeatColor(ping.lastValue);
  const lossColor = lossHeatColor(ping.loss);
  const latencyHoverColor = hoveredLatencyBucket?.value != null
    ? latencyHeatColor(hoveredLatencyBucket.value)
    : "var(--text-tertiary)";
  const loadBaseline = node.cpu_cores > 0 ? node.cpu_cores : 4;
  const loadFraction = Math.max(0, Math.min(1, node.load1 / loadBaseline));
  const upRate = formatTrafficRate(node.netUp);
  const downRate = formatTrafficRate(node.netDown);
  const lossHoverColor = hoveredLossBucket ? lossHeatColor(hoveredLossBucket.loss) : null;
  const hasHomepagePingBinding = ping.isAssigned;
  const isOnline = node.online === true;
  const isOffline = node.online === false;
  const offlineFor = isOffline ? formatOfflineDuration(node.updatedAt) : null;

  // 动态决定流量进度条的颜色
  const trafficBarColor = trafficInfo.isInfinite
    ? "var(--status-success)"
    : trafficInfo.percent > 20
      ? "var(--progress-disk)"
      : "var(--status-offline)";

  return (
    <article
      className={clsx("server-card", isOffline && "is-offline")}
      data-appearance={resolvedAppearance}
    >
      {isOffline && (
        <div className="offline-mask">
          <span className="offline-badge" title={offlineFor?.full}>
            <Power size={14} strokeWidth={2.2} />
            <span className="offline-badge-copy">
              <span>离线</span>
              <span className="offline-badge-time">
                {offlineFor?.value}
                {offlineFor?.unit ? ` ${offlineFor.unit}` : ""}
              </span>
            </span>
          </span>
        </div>
      )}

      <div className="server-card-content">
        <header className="server-card-header">
          <div className="server-card-title-block">
            <div className="server-card-title-row">
              <Flag region={node.region} size={15} />
              <Link
                to={`/instance/${node.uuid}`}
                className="server-card-title-link"
                title={node.name}
              >
                {node.name}
              </Link>
              <span
                className={clsx("server-card-online-dot", isOffline && "is-offline")}
                style={{
                  background:
                    node.online == null
                      ? "var(--text-tertiary)"
                      : isOnline
                        ? "var(--status-online)"
                        : "var(--status-offline)",
                  boxShadow: `0 0 0 3px color-mix(in srgb, ${
                    node.online == null
                      ? "var(--text-tertiary)"
                      : isOnline
                        ? "var(--status-online)"
                        : "var(--status-offline)"
                  } 20%, transparent)`,
                }}
                title={node.online == null ? "状态同步中" : isOnline ? "在线" : "离线"}
              />
            </div>
            {subtitle && (
              <p className="server-card-subtitle" title={subtitle}>
                {subtitle}
              </p>
            )}
          </div>
          <Link
            to={`/instance/${node.uuid}`}
            className="server-card-detail-link"
            title="查看详情"
          >
            <ExternalLink size={15} strokeWidth={2} />
          </Link>
        </header>

        <div className="server-card-stack">
          <div className="card-metric-section server-metric-grid">
            <MetricBar
              icon={<Cpu size={13} strokeWidth={2} />}
              label="CPU"
              valueText={node.cpuPct.toFixed(2)}
              unit="%"
              detailText={`${node.cpu_cores || 0} 核`}
              fraction={node.cpuPct / 100}
              redrawKey={resolvedAppearance}
              paint={{ kind: "solid", color: "var(--progress-cpu)" }}
            />
            <MetricBar
              icon={<MemoryStick size={13} strokeWidth={2} />}
              label="内存"
              valueText={node.ramPct.toFixed(2)}
              unit="%"
              detailText={`${formatBytes(node.ramUsed)} / ${formatBytes(node.ramTotal)}`}
              fraction={node.ramPct / 100}
              redrawKey={resolvedAppearance}
              paint={{ kind: "solid", color: "var(--progress-memory)" }}
            />
            <MetricBar
              icon={<HardDrive size={13} strokeWidth={2} />}
              label="磁盘"
              valueText={node.diskPct.toFixed(1)}
              unit="%"
              detailText={`${formatBytes(node.diskUsed)} / ${formatBytes(node.diskTotal)}`}
              fraction={node.diskPct / 100}
              redrawKey={resolvedAppearance}
              paint={{ kind: "solid", color: "var(--progress-disk)" }}
            />
            <MetricBar
              icon={<Gauge size={13} strokeWidth={2} />}
              label="负载"
              valueText={node.load1.toFixed(2)}
              fraction={loadFraction}
              redrawKey={resolvedAppearance}
              paint={{
                kind: "gradient",
                from: "var(--progress-cpu)",
                to: "var(--progress-memory)",
              }}
            />
          </div>

          <div className="card-metric-section server-traffic-section">
            <TrafficStat
              direction="上行"
              totalLabel="出站"
              rate={upRate}
              total={formatBytes(node.trafficUp)}
              samples={trafficTrend.up}
              live={isOnline}
              redrawKey={resolvedAppearance}
              color="var(--progress-cpu)"
              icon={<ArrowUp size={15} strokeWidth={2.4} />}
            />
            <TrafficStat
              direction="下行"
              totalLabel="入站"
              rate={downRate}
              total={formatBytes(node.trafficDown)}
              samples={trafficTrend.down}
              live={isOnline}
              redrawKey={resolvedAppearance}
              color="var(--status-success)"
              icon={<ArrowDown size={15} strokeWidth={2.4} />}
            />
          </div>

          <div className="card-metric-section card-metric-divided server-health-grid">
            <div className="server-health-block">
              <div className="server-health-head">
                <div className="server-health-label">
                  <Clock3 size={13} strokeWidth={2} />
                  <span>延迟</span>
                </div>
                <span className="server-health-value tabular" style={{ color: latencyColor }}>
                  {ping.lastValue != null ? (
                    <>
                      {Math.round(ping.lastValue)}
                      <span className="server-health-unit">ms</span>
                    </>
                  ) : (
                    <span
                      className="server-health-empty"
                      title={hasHomepagePingBinding ? "暂无有效样本" : "未配置首页 Ping"}
                    >
                      {hasHomepagePingBinding ? "无样本" : "未配置"}
                    </span>
                  )}
                </span>
              </div>
              <div className="server-health-chart-wrap">
                {hasHomepagePingBinding ? (
                  <MiniBars
                    values={ping.values}
                    max={ping.max}
                    lastValue={ping.lastValue ?? undefined}
                    buckets={pingBuckets}
                    redrawKey={resolvedAppearance}
                    onHoverIndex={setHoveredLatencyIndex}
                  />
                ) : (
                  <div className="server-health-placeholder">未配置首页 Ping</div>
                )}
                {latencyHoverTime && hoveredLatencyBucket && (
                  <div className="server-health-tooltip">
                    <div className="instance-chart-tooltip-time">{latencyHoverTime}</div>
                    <div className="instance-chart-tooltip-row">
                      <span className="instance-chart-tooltip-dot" style={{ background: latencyHoverColor }} />
                      <span>延迟</span>
                      <strong>{formatLatencyBucketSummary(hoveredLatencyBucket)}</strong>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="server-health-block">
              <div className="server-health-head">
                <div className="server-health-label">
                  <Unplug size={13} strokeWidth={2} />
                  <span>丢包率</span>
                </div>
                <span className="server-health-value tabular" style={{ color: lossColor }}>
                  {ping.loss != null ? (
                    <>
                      {ping.loss.toFixed(1)}
                      <span className="server-health-unit">%</span>
                    </>
                  ) : (
                    <span
                      className="server-health-empty"
                      title={hasHomepagePingBinding ? "暂无有效样本" : "未配置首页 Ping"}
                    >
                      {hasHomepagePingBinding ? "无样本" : "未配置"}
                    </span>
                  )}
                </span>
              </div>
              <div className="server-health-chart-wrap">
                {hasHomepagePingBinding ? (
                  <QualityBars
                    value={ping.loss}
                    buckets={pingBuckets}
                    redrawKey={resolvedAppearance}
                    onHoverIndex={setHoveredLossIndex}
                  />
                ) : (
                  <div className="server-health-placeholder">未配置首页 Ping</div>
                )}
                {lossHoverTime && hoveredLossBucket && (
                  <div className="server-health-tooltip">
                    <div className="instance-chart-tooltip-time">{lossHoverTime}</div>
                    <div className="instance-chart-tooltip-row">
                      <span className="instance-chart-tooltip-dot" style={{ background: lossHoverColor ?? lossColor }} />
                      <span>丢包率</span>
                      <strong>{formatLossBucketSummary(hoveredLossBucket)}</strong>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 页脚布局 */}
        <div className="server-card-footer" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          
          {/* 上层：剩余流量独占一整行，集成 MetricBar 进度条 */}
          <div 
            className="server-traffic-bar-wrapper" 
            style={{ 
              width: "100%",
              paddingTop: "4px",
              display: "flex",
              flexDirection: "column",
              gap: "4px"
            }}
          >
            <MetricBar
              icon={<Globe size={13} strokeWidth={2} />}
              label="剩余流量"
              valueText={trafficInfo.text}
              unit={!trafficInfo.isInfinite ? `(${trafficInfo.percent}%)` : undefined}
              fraction={trafficInfo.percent / 100}
              redrawKey={resolvedAppearance}
              paint={{ kind: "solid", color: trafficBarColor }}
            />
          </div>

          {/* 下层：到期和在线并排分列，与流量栏以虚线隔离 */}
          <div 
            className="server-card-meta-grid" 
            style={{ 
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))", 
              width: "100%",
              paddingTop: "8px",
              borderTop: "1px dashed color-mix(in srgb, var(--text-tertiary) 15%, transparent)"
            }}
          >
            <FooterStat
              icon={<Calendar size={13} strokeWidth={2} />}
              label="到期"
              value={expire.value}
              unit={expire.unit}
              color={getExpireTextColor(node.expired_at)}
            />
            <FooterStat
              icon={<RefreshCw size={13} strokeWidth={2} />}
              label="在线"
              value={uptime.value}
              unit={uptime.unit}
              color="var(--progress-cpu)"
            />
          </div>

          {/* 标签栏（如果有的话） */}
          {footerTags.length > 0 && (
            <div className="dstatus-tags-row" style={{ marginTop: "2px" }}>
              {footerTags.slice(0, 6).map((tag, i) => (
                <span
                  key={`${tag.label}-${i}`}
                  data-tag={tag.color}
                  className="dstatus-tag-chip"
                  style={{
                    background: "var(--tag-bg)",
                    color: "var(--tag-fg)",
                  }}
                  title={tag.label}
                >
                  {tag.label}
                </span>
              ))}
              {footerTags.length > 6 && (
                <span className="dstatus-tag-more">+{footerTags.length - 6}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
});

// TrafficStat, TrafficDotStrip, GlobeArrow, FooterStat 组件保持不变...

```
