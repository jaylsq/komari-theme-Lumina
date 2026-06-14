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
  History,
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
 * 流量数据解析函数 - 深度优化：优化今日已用的进度条与百分比基准
 */
function getTrafficInfo(node: any) {
  const limitBytes = Number(node.traffic_limit || 0);
  const currentTotalBytes = Number(node.trafficUp || 0) + Number(node.trafficDown || 0);
  
  // 生成今天日期的 key
  const todayStr = new Date().toISOString().split('T')[0];
  const storageKeyToday = `traffic_base_${node.uuid}_${todayStr}`;

  // 1. 获取或锁定今天凌晨第一次打开网页时的流量基准
  let todayBase = localStorage.getItem(storageKeyToday);
  if (!todayBase) {
    localStorage.setItem(storageKeyToday, String(currentTotalBytes));
    todayBase = String(currentTotalBytes);
    
    // 自动清理旧缓存
    try {
      const obsoleteDate = new Date();
      obsoleteDate.setDate(obsoleteDate.getDate() - 3);
      const oldKey = `traffic_base_${node.uuid}_${obsoleteDate.toISOString().split('T')[0]}`;
      localStorage.removeItem(oldKey);
    } catch (e) {}
  }

  // 2. 计算今天实际跑了多少流量
  const todayBytes = Math.max(0, currentTotalBytes - Number(todayBase));
  const todayText = formatBytes(todayBytes);

  // 💡 核心优化：动态计算今日已用进度条的“每日参考基准值”
  // 如果有限额，每日基准 = 总额度 / 30天；如果是无限额，默认给一个 10 GB 的每日看板基准
  const dailyTargetBytes = limitBytes > 0 ? limitBytes / 30 : 10 * 1024 * 1024 * 1024;
  
  // 计算今天已用掉每日额度的百分比（最高 100%）
  const todayPercent = Math.min(100, Math.round((todayBytes / dailyTargetBytes) * 100));

  // 无限流量模式
  if (limitBytes <= 0) {
    return { 
      valueText: "无限", 
      unit: undefined, 
      detailText: "无上限", 
      percent: 100, 
      isInfinite: true,
      todayText,
      todayPercent
    };
  }

  // 有限流量总额度的剩余计算
  let usedBytes = 0;
  if (node.traffic_limit_type === "sum") {
    usedBytes = (node.trafficUp || 0) + (node.trafficDown || 0);
  } else {
    usedBytes = node.trafficUp || 0;
  }

  const remainingBytes = Math.max(0, limitBytes - usedBytes);
  const percent = Math.round((remainingBytes / limitBytes) * 100);

  let remainingText = "";
  if (remainingBytes >= 1024 * 1024 * 1024 * 1024) {
    remainingText = `${(remainingBytes / (1024 * 1024 * 1024 * 1024)).toFixed(1)} TB`;
  } else {
    remainingText = `${(remainingBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  return { 
    valueText: String(percent), 
    unit: "%", 
    detailText: `还剩 ${remainingText}`, 
    percent: percent, 
    isInfinite: false,
    todayText,
    todayPercent
  };
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
        style={{ minHeight: 410 }}
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

  const trafficBarColor = trafficInfo.isInfinite
    ? "var(--status-success, #22c55e)"
    : trafficInfo.percent <= 20
      ? "var(--status-warning, #f97316)" 
      : "var(--status-success, #22c55e)";

  // 💡 今日已用进度条颜色控制：用量过大（比如超过每日平均线 80%）时自动调为警告色
  const todayBarColor = trafficInfo.todayPercent >= 80 
    ? "var(--status-warning, #f97316)" 
    : "var(--text-secondary, #71717a)";

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
          {/* 系统指标 Grid */}
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

          {/* 实时网速速率区 */}
          <div className="card-metric-section server-traffic-section">
            <TrafficStat
              direction="上行"
              rate={upRate}
              samples={trafficTrend.up}
              live={isOnline}
              redrawKey={resolvedAppearance}
              color="var(--progress-cpu)"
              icon={<ArrowUp size={15} strokeWidth={2.4} />}
            />
            <TrafficStat
              direction="下行"
              rate={downRate}
              samples={trafficTrend.down}
              live={isOnline}
              redrawKey={resolvedAppearance}
              color="var(--status-success)"
              icon={<ArrowDown size={15} strokeWidth={2.4} />}
            />
          </div>

          {/* 延迟与丢包率 */}
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
          
          {/* 双列流量模块栅格 */}
          <div 
            className="server-traffic-module-grid" 
            style={{ 
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))", 
              gap: "16px",
              width: "100%",
              paddingTop: "4px"
            }}
          >
            {/* 左边：今日已用流量模块 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-secondary)" }}>
                <History size={13} strokeWidth={2} />
                <span style={{ fontSize: "12px", fontWeight: 500 }}>今日已用</span>
              </div>
              <MetricBar
                icon={<></>}
                fraction={trafficInfo.todayPercent / 100}
                redrawKey={resolvedAppearance}
                paint={{ kind: "solid", color: todayBarColor }}
                label=""
                valueText=""
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "12px", marginTop: "1px" }}>
                <span style={{ color: "var(--text-main)", fontWeight: "500" }}>
                  {trafficInfo.todayText}
                </span>
                <span style={{ color: todayBarColor, fontSize: "11px", fontWeight: "500" }}>
                  占 {trafficInfo.todayPercent}%
                </span>
              </div>
            </div>

            {/* 右边：剩余流量模块 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-secondary)" }}>
                <Globe size={13} strokeWidth={2} />
                <span style={{ fontSize: "12px", fontWeight: 500 }}>剩余流量</span>
              </div>
              <MetricBar
                icon={<></>}
                fraction={trafficInfo.isInfinite ? 1 : trafficInfo.percent / 100}
                redrawKey={resolvedAppearance}
                paint={{ kind: "solid", color: trafficBarColor }}
                label="" 
                valueText=""
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "12px", marginTop: "1px" }}>
                <span style={{ color: "var(--text-tertiary)", fontSize: "11px" }}>
                  {trafficInfo.detailText}
                </span>
                <span style={{ color: trafficBarColor, fontWeight: "600", fontSize: "13px" }}>
                  {trafficInfo.valueText}
                  {trafficInfo.unit && <span style={{ fontSize: "10px", marginLeft: "1px", fontWeight: "400" }}>{trafficInfo.unit}</span>}
                </span>
              </div>
            </div>
          </div>

          {/* 下层：到期和在线并排 */}
          <div 
            className="server-card-meta-grid" 
            style={{ 
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))", 
              width: "100%",
              paddingTop: "10px",
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

          {/* 标签 chips */}
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

function TrafficStat({
  direction,
  rate,
  samples,
  live,
  redrawKey,
  color,
  icon,
}: {
  direction: "下行" | "上行";
  rate: TrafficRateDisplay;
  samples: TrafficTrendSample[];
  live: boolean;
  redrawKey: string;
  color: string;
  icon: ReactNode;
}) {
  return (
    <div className="traffic-stat">
      <div className="traffic-stat-head">
        <div className="traffic-stat-label" style={{ color }}>
          {icon}
          <span>{direction}</span>
        </div>
        <span className="traffic-stat-value tabular" style={{ color }}>
          {rate.value}
          <span className="traffic-stat-unit">{rate.unit}</span>
        </span>
      </div>
      <div className="traffic-stat-trend" aria-hidden>
        <TrafficDotStrip samples={samples} color={color} redrawKey={redrawKey} />
        <span className="traffic-stat-live" data-live={live ? "true" : "false"}>
          <span
            className="traffic-stat-live-dot"
            style={{
              background: color,
            }}
          />
          <span>{live ? (rate.bitsPerSec > 0 ? "实时" : "空闲") : "离线"}</span>
        </span>
      </div>
    </div>
  );
}

// 趋势点绘制
function TrafficDotStrip({
  samples,
  color,
  redrawKey,
}: {
  samples: TrafficTrendSample[];
  color: string;
  redrawKey: string;
}) {
  return (
    <CanvasStrip
      className="traffic-dot-strip"
      height={10}
      ariaHidden
      redrawKey={redrawKey}
      draw={(ctx, width, height) => {
        if (samples.length === 0) return;
        const slotWidth = width / samples.length;
        const styles = getComputedStyle(document.documentElement);
        
        const baseColor = resolveCssColor(color, styles);
        const inactiveColor = resolveCssColor("var(--progress-bg)", styles);

        samples.forEach((sample, index) => {
          const hasTraffic = sample.value > 0;
          const slotX = index * slotWidth + slotWidth / 2;
          const slotY = height / 2;
          const radius = 2 * (hasTraffic ? 0.72 + sample.level * 0.82 : 0.46);

          ctx.beginPath();
          ctx.arc(slotX, slotY, radius, 0, Math.PI * 2);
          
          if (hasTraffic) {
            ctx.fillStyle = baseColor;
            ctx.globalAlpha = Math.min(1, (sample.opacity || 0.5) + sample.level * 0.3);
          } else {
            ctx.fillStyle = inactiveColor;
            ctx.globalAlpha = 0.35;
          }
          
          ctx.fill();
        });

        ctx.globalAlpha = 1;
      }}
    />
  );
}

// 底部单项小组件
function FooterStat({
  icon,
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: string;
  unit?: string;
  color: string;
  icon: ReactNode;
}) {
  return (
    <div className="server-card-meta">
      <div className="server-card-meta-label">
        {icon}
        <span>{label}</span>
      </div>
      <span className="server-card-meta-value tabular" style={{ color }}>
        {value}
        {unit && <span className="server-card-meta-unit"> {unit}</span>}
      </span>
    </div>
  );
}
