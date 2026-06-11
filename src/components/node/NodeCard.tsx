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
 * 健壮的流量解析函数
 */
function parseTrafficRemark(remark: string | null | undefined, usedBytes: number) {
  if (!remark) return null;

  // 统一转为字符串并清理两端空格
  const cleanRemark = String(remark).trim();

  // 正则匹配：支持 流量:、流量：、流量=、流量 = 以及各类空白符，抓取到换行或空格前的文本
  const match = cleanRemark.match(/流量[:：=\s]\s*([^\s\n]+)/i);
  
  // 如果压根没有“流量”关键字，返回 null 以便外层渲染“未配置”
  if (!match) return null;

  const target = match[1].trim();

  // 判断是否为无限流量
  if (target.includes("无限") || target.includes("INFINITE") || target.includes("INF")) {
    return { text: "无限", percent: 100, isInfinite: true };
  }

  // 解析数字和单位 (支持 GB, TB, MB)
  const numMatch = target.match(/^([0-9.]+)\s*([gGtTmM][bB])/);
  if (!numMatch) {
    // 无法解析出标准单位时，原样展示获取到的文本（如：1000兆）
    return { text: target, percent: 0, isInfinite: false };
  }

  const amount = parseFloat(numMatch[1]);
  const unit = numMatch[2].toUpperCase();
  
  // 统一转换为字节 (Bytes)
  let totalBytes = 0;
  if (unit === "GB") totalBytes = amount * 1024 * 1024 * 1024;
  if (unit === "TB") totalBytes = amount * 1024 * 1024 * 1024 * 1024;
  if (unit === "MB") totalBytes = amount * 1024 * 1024;

  const remainingBytes = Math.max(0, totalBytes - usedBytes);
  const percent = totalBytes > 0 ? Math.round((remainingBytes / totalBytes) * 100) : 0;

  // 格式化剩余流量显示
  let text = "";
  if (remainingBytes >= 1024 * 1024 * 1024 * 1024) {
    text = `${(remainingBytes / (1024 * 1024 * 1024 * 1024)).toFixed(1)} TB`;
  } else {
    text = `${(remainingBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  return { text, percent, isInfinite: false };
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

  // 聚合读取可能的备注字段，防止因面板版本不同导致数据拿不到
  const rawRemark = node.public_remark ?? (node as any).remark ?? (node as any).internal_remark;

  const tags = parseTags(node.tags);
  const footerTags =
    tags.length > 0
      ? tags
      : node.group
        ? [{ label: node.group, color: "gray" }]
        : [];
  const expire = formatExpireDays(node.expired_at);
  const uptime = formatUptimeDays(node.uptime);

  // 计算总已用流量并解析剩余流量
  const totalUsedBytes = (node.trafficUp || 0) + (node.trafficDown || 0);
  const trafficInfo = parseTrafficRemark(rawRemark, totalUsedBytes);

  // 净化副标题：过滤掉备注中的流量文本，避免在副标题重复展示
  const cleanedRemark = rawRemark
    ? String(rawRemark).replace(/流量[:：=\s]\s*[^\s]+/g, "").trim()
    : null;

  const subtitle =
    buildSubtitle([node.group, cleanedRemark]) ||
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

        <div className="server-card-footer">
          {/* 三列网格：平铺展示 到期、在线和剩余流量 */}
          <div className="server-card-meta-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
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
            <FooterStat
              icon={<Globe size={13} strokeWidth={2} />}
              label="剩余"
              value={trafficInfo ? trafficInfo.text : "未配置"}
              unit={trafficInfo && !trafficInfo.isInfinite ? `${trafficInfo.percent}%` : undefined}
              color={
                trafficInfo
                  ? trafficInfo.isInfinite
                    ? "var(--status-success)" // 无限流显示绿色
                    : trafficInfo.percent > 20
                      ? "var(--text-secondary)" // 流量充足显示标准色
                      : "var(--status-offline)" // 流量不足 20% 时高亮变红警示
                  : "var(--text-tertiary)" // 未配置显示暗灰色
              }
            />
          </div>
          {footerTags.length > 0 && (
            <div className="dstatus-tags-row">
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
  totalLabel,
  rate,
  total,
  samples,
  live,
  redrawKey,
  color,
  icon,
}: {
  direction: "下行" | "上行";
  totalLabel: "入站" | "出站";
  rate: TrafficRateDisplay;
  total: string;
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
      <div className="traffic-stat-foot">
        <div className="traffic-stat-total-label">
          <GlobeArrow direction={totalLabel} color={color} />
          <span>{totalLabel}</span>
        </div>
        <span className="tabular">{total}</span>
      </div>
    </div>
  );
}

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
          const scale = hasTraffic ? 0.72 + sample.level * 0.82 : 0.46;
          const radius = 2 * scale;
          const tone = hasTraffic
            ? `color-mix(in srgb, ${baseColor} ${Math.round(68 + sample.level * 20)}%, white ${Math.round(32 - sample.level * 20)}%)`
            : inactiveColor;
          const x = index * slotWidth + slotWidth / 2;
          const y = height / 2;

          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fillStyle = tone;
          ctx.globalAlpha = hasTraffic ? Math.min(1, sample.opacity + 0.05) : 0.46;
          ctx.fill();
        });

        ctx.globalAlpha = 1;
      }}
    />
  );
}

function GlobeArrow({
  direction,
  color,
}: {
  direction: "入站" | "出站";
  color: string;
}) {
  const isInbound = direction === "入站";
  return (
    <span
      className="relative inline-flex items-center justify-center"
      style={{
        width: 18,
        height: 18,
        color,
      }}
      aria-hidden
    >
      <Globe size={15} strokeWidth={1.9} />
      {isInbound ? (
        <ArrowDown
          size={9}
          strokeWidth={2.4}
          className="absolute -right-[2px] bottom-[-1px]"
        />
      ) : (
        <ArrowUp
          size={9}
          strokeWidth={2.4}
          className="absolute -right-[2px] bottom-[-1px]"
        />
      )}
    </span>
  );
}

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
