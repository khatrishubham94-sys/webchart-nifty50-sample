import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { IChartApi, Time } from "lightweight-charts";
import { computeVolumeProfile, type VPBlock, type VolumeProfilePrimitive } from "./volumeProfile";
import { VP_COLORS, buildPeriodicBlocks, type Candle, type PeriodicMode } from "./lib";

// Visible-range, periodic, fixed-range and anchored volume profile — all four modes share
// one primitive and get recomputed together whenever any of their inputs change. Reads its
// toggle state through refs (kept in sync each render) so the recompute function itself
// stays ref-only and safe to call from a mount-time effect closure without going stale.
export function useVolumeProfile(
  vpPrimitiveRef: RefObject<VolumeProfilePrimitive | null>,
  chartRef: RefObject<IChartApi | null>,
  candlesRef: RefObject<Candle[]>,
  showVRVP: boolean,
  periodicMode: PeriodicMode,
  frvpRanges: [string, string][],
  avpAnchorTime: string | null
) {
  const showVRVPRef = useRef(showVRVP);
  const periodicModeRef = useRef(periodicMode);
  const frvpRangesRef = useRef(frvpRanges);
  const avpAnchorTimeRef = useRef(avpAnchorTime);
  showVRVPRef.current = showVRVP;
  periodicModeRef.current = periodicMode;
  frvpRangesRef.current = frvpRanges;
  avpAnchorTimeRef.current = avpAnchorTime;

  function recomputeVP() {
    if (!vpPrimitiveRef.current || !chartRef.current) return;
    const candles = candlesRef.current;
    const blocks: VPBlock[] = [];

    if (showVRVPRef.current) {
      const range = chartRef.current.timeScale().getVisibleRange();
      if (range) {
        const visible = candles.filter((c) => c.time >= (range.from as string) && c.time <= (range.to as string));
        if (visible.length) {
          blocks.push({
            id: "vrvp",
            startTime: visible[0].time as Time,
            endTime: visible[visible.length - 1].time as Time,
            profile: computeVolumeProfile(visible, 24),
            color: VP_COLORS.vrvp.bar,
            pocColor: VP_COLORS.vrvp.poc,
          });
        }
      }
    }

    if (periodicModeRef.current !== "off") {
      const range = chartRef.current.timeScale().getVisibleRange();
      const visible = range
        ? candles.filter((c) => c.time >= (range.from as string) && c.time <= (range.to as string))
        : candles;
      blocks.push(...buildPeriodicBlocks(visible, periodicModeRef.current));
    }

    frvpRangesRef.current.forEach(([start, end], i) => {
      const inRange = candles.filter((c) => c.time >= start && c.time <= end);
      if (!inRange.length) return;
      blocks.push({
        id: `frvp-${i}`,
        startTime: start as Time,
        endTime: end as Time,
        profile: computeVolumeProfile(inRange, 24),
        color: VP_COLORS.frvp.bar,
        pocColor: VP_COLORS.frvp.poc,
      });
    });

    if (avpAnchorTimeRef.current) {
      const startIdx = candles.findIndex((c) => c.time === avpAnchorTimeRef.current);
      if (startIdx >= 0) {
        const fromAnchor = candles.slice(startIdx);
        blocks.push({
          id: "avp",
          startTime: avpAnchorTimeRef.current as Time,
          endTime: null,
          profile: computeVolumeProfile(fromAnchor, 24),
          color: VP_COLORS.avp.bar,
          pocColor: VP_COLORS.avp.poc,
        });
      }
    }
    vpPrimitiveRef.current.setBlocks(blocks);
  }

  useEffect(() => {
    recomputeVP();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showVRVP, periodicMode, frvpRanges, avpAnchorTime]);

  return { recomputeVP };
}
