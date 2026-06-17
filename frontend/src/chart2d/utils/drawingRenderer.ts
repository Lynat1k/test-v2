export type DrawingType =
  | "trend"
  | "arrow"
  | "channel"
  | "horizontal"
  | "rect"
  | "fibonacci"
  | "ruler"
  | "text"
  | "volume";

export interface DrawingItem {
  id: number;
  type: DrawingType;
  startIdx: number;
  startPrice: number;
  endIdx: number;
  endPrice: number;
  text: string;
  stage?: number;
  offsetPrice?: number;
  color?: string;
  fontSize?: number;
}

interface RenderContext {
  ctx: CanvasRenderingContext2D;
  drawings: DrawingItem[];
  drawingInProgress: DrawingItem | null;
  selectedDrawingId: number | null;
  visibleScrollLeft: number;
  viewportWidth: number;
  chartHeight: number;
  margin: { top: number; bottom: number; left: number; right: number };
  isLight: boolean;
  priceToY: (price: number) => number;
  activePair: { price: number; priceStep?: number };
  candles: Array<{
    open: number;
    close: number;
    high: number;
    low: number;
    volume: number;
    cells?: Array<{ price: number; volume: number; bid: number; ask: number }>;
  }>;
  candleWidth: number;
  candleSpacing: number;
  layer?: "background" | "foreground";
}

export function drawDrawingObjects(ctx: CanvasRenderingContext2D, renderParams: RenderContext) {
  const {
    drawings,
    drawingInProgress,
    selectedDrawingId,
    visibleScrollLeft,
    viewportWidth,
    chartHeight: _chartHeight,
    margin,
    isLight,
    priceToY,
    activePair,
    candles,
    candleWidth,
    candleSpacing,
    layer = "foreground",
  } = renderParams;

  const candleWidthSpacing = candleWidth + candleSpacing;
  const indexToX = (idx: number) => margin.left + idx * candleWidthSpacing;

  const allDrawings = [...drawings, ...(drawingInProgress ? [drawingInProgress] : [])];

  allDrawings.forEach((d) => {
    const isVolumeType = d.type === "volume";
    if (layer === "background" && !isVolumeType) return;
    if (layer === "foreground" && isVolumeType) return;

    const y1 = priceToY(d.startPrice);
    const y2 = priceToY(d.endPrice);
    const x1 = indexToX(d.startIdx);
    const x2 = indexToX(d.endIdx);

    if (d.type === "trend") {
      ctx.beginPath();
      ctx.strokeStyle = isLight ? "#1e293b" : "#e2e8f0";
      ctx.lineWidth = 2.2;
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      ctx.fillStyle = "#f59e0b";
      ctx.beginPath();
      ctx.arc(x1, y1, 4, 0, Math.PI * 2);
      ctx.arc(x2, y2, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    else if (d.type === "horizontal") {
      ctx.beginPath();
      ctx.strokeStyle = isLight ? "#ea580c" : "#f97316";
      ctx.lineWidth = 1.8;
      ctx.setLineDash([6, 4]);
      ctx.moveTo(visibleScrollLeft + margin.left, y1);
      ctx.lineTo(visibleScrollLeft + viewportWidth - margin.right, y1);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    else if (d.type === "rect") {
      ctx.beginPath();
      ctx.strokeStyle = isLight ? "#3b82f6" : "#60a5fa";
      ctx.lineWidth = 1.6;
      ctx.fillStyle = isLight ? "rgba(59, 130, 246, 0.08)" : "rgba(96, 165, 250, 0.12)";
      ctx.rect(x1, y1, x2 - x1, y2 - y1);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#3b82f6";
      ctx.beginPath();
      ctx.arc(x1, y1, 3.5, 0, Math.PI * 2);
      ctx.arc(x2, y2, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    else if (d.type === "fibonacci") {
      const fibLevels = [
        { ratio: 0, label: "0.0% (Start)" },
        { ratio: 0.236, label: "23.6%" },
        { ratio: 0.382, label: "38.2%" },
        { ratio: 0.5, label: "50.0%" },
        { ratio: 0.618, label: "61.8%" },
        { ratio: 0.786, label: "78.6%" },
        { ratio: 1, label: "100.0% (End)" },
      ];

      const priceDiff = d.endPrice - d.startPrice;
      ctx.lineWidth = 1.2;

      fibLevels.forEach((level) => {
        const currentLevelPrice = d.startPrice + priceDiff * level.ratio;
        const fY = priceToY(currentLevelPrice);

        ctx.beginPath();
        if (level.ratio === 0 || level.ratio === 1) {
          ctx.strokeStyle = "#ef4444";
        } else if (level.ratio === 0.5 || level.ratio === 0.618) {
          ctx.strokeStyle = "#f59e0b";
        } else {
          ctx.strokeStyle = isLight ? "rgba(100, 116, 139, 0.6)" : "rgba(148, 163, 184, 0.5)";
        }
        ctx.moveTo(x1, fY);
        ctx.lineTo(x2, fY);
        ctx.stroke();

        ctx.font = "9px sans-serif";
        ctx.fillStyle = isLight ? "#475569" : "#cbd5e1";
        ctx.fillText(`${level.label} - ${currentLevelPrice.toFixed(1)}`, Math.min(x1, x2) + 5, fY - 7);
      });
    }
    else if (d.type === "ruler") {
      ctx.beginPath();
      ctx.strokeStyle = "#0ea5e9";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 2]);
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "rgba(14, 165, 233, 0.08)";
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);

      const pStart = d.startPrice;
      const pEnd = d.endPrice;
      const absDiff = pEnd - pStart;
      const pctDiff = pStart !== 0 ? (absDiff / pStart) * 100 : 0;

      const barCount = Math.max(1, Math.round(Math.abs(d.endIdx - d.startIdx)));

      const cardW = 142;
      const cardH = 54;
      const centerX = x1 + (x2 - x1) / 2;
      const centerY = y2 - 15;

      ctx.fillStyle = isLight ? "rgba(255, 255, 255, 0.95)" : "rgba(3, 7, 18, 0.88)";
      ctx.strokeStyle = "#0ea5e9";
      ctx.lineWidth = 1;
      ctx.beginPath();
      if ((ctx as any).roundRect) {
        (ctx as any).roundRect(centerX - cardW / 2, centerY - cardH / 2, cardW, cardH, 6);
      } else {
        ctx.rect(centerX - cardW / 2, centerY - cardH / 2, cardW, cardH);
      }
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isLight ? "#0f172a" : "#ffffff";
      ctx.font = "bold 9.5px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${pctDiff >= 0 ? "\u25B2" : "\u25BC"} ${pctDiff.toFixed(2)}% (${absDiff.toFixed(1)} USDT)`, centerX, centerY - 11);

      ctx.font = "9px monospace";
      ctx.fillStyle = "#a1a1aa";
      ctx.fillText(`${barCount} \u0411\u0430\u0440(\u043e\u0432)`, centerX, centerY + 3);
      ctx.fillText(`${pStart.toFixed(1)} \u2192 ${pEnd.toFixed(1)}`, centerX, centerY + 14);
      ctx.textAlign = "left";
    }
    else if (d.type === "text") {
      ctx.fillStyle = d.color || (isLight ? "#1e293b" : "#f1f5f9");
      const fSize = d.fontSize || 11;
      ctx.font = `bold ${fSize}px sans-serif`;
      ctx.fillText(d.text || "TEXT", x1, y1);
    }
    else if (d.type === "arrow") {
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = isLight ? "#dc2626" : "#ef4444";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLength = 12;
      ctx.fillStyle = isLight ? "#dc2626" : "#ef4444";
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLength * Math.cos(angle - Math.PI / 6), y2 - headLength * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(x2 - headLength * Math.cos(angle + Math.PI / 6), y2 - headLength * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    else if (d.type === "channel") {
      ctx.save();
      const isStaging = d.stage === 1;
      const offsetVal = d.offsetPrice !== undefined ? d.offsetPrice : (activePair.priceStep || 0.1) * 20;
      const y1_offset = priceToY(d.startPrice + offsetVal);
      const y2_offset = priceToY(d.endPrice + offsetVal);
      const y1_mid = priceToY(d.startPrice + offsetVal / 2);
      const y2_mid = priceToY(d.endPrice + offsetVal / 2);

      ctx.beginPath();
      ctx.strokeStyle = isLight ? "#2563eb" : "#3b82f6";
      ctx.lineWidth = 2.0;
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      if (!isStaging) {
        ctx.beginPath();
        ctx.moveTo(x1, y1_offset);
        ctx.lineTo(x2, y2_offset);
        ctx.stroke();

        ctx.beginPath();
        ctx.strokeStyle = isLight ? "rgba(37, 99, 235, 0.45)" : "rgba(96, 165, 250, 0.45)";
        ctx.lineWidth = 1.25;
        ctx.setLineDash([6, 5]);
        ctx.moveTo(x1, y1_mid);
        ctx.lineTo(x2, y2_mid);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.restore();
    }
    else if (d.type === "volume") {
      ctx.beginPath();
      ctx.strokeStyle = "rgba(168, 85, 247, 0.8)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(168, 85, 247, 0.03)";
      ctx.fill();

      const minX = Math.min(x1, x2);
      const maxX = Math.max(x1, x2);
      const startIndex = Math.max(0, Math.floor(Math.min(d.startIdx, d.endIdx)));
      const endIndex = Math.min(candles.length - 1, Math.floor(Math.max(d.startIdx, d.endIdx)));

      if (startIndex <= endIndex) {
        const minPrice = Math.min(d.startPrice, d.endPrice);
        const maxPrice = Math.max(d.startPrice, d.endPrice);
        const priceDiff = maxPrice - minPrice;
        const priceStep = activePair.priceStep || 1;
        const bucketCount = Math.max(1, Math.round(priceDiff / priceStep));

        const bMinY = Math.min(y1, y2);
        const bMaxY = Math.max(y1, y2);
        const bHeight = bMaxY - bMinY;
        const bHeightStep = bHeight / bucketCount;

        const profileBins = Array.from({ length: bucketCount }, () => 0);

        for (let cIdx = startIndex; cIdx <= endIndex; cIdx++) {
          const c = candles[cIdx]!;
          if (c.cells) {
            c.cells.forEach((cell) => {
              const cellY = priceToY(cell.price);
              if (cellY >= bMinY && cellY <= bMaxY) {
                const binIdx = Math.min(
                  bucketCount - 1,
                  Math.max(0, Math.floor((maxPrice - cell.price) / priceStep))
                );
                if (binIdx >= 0) {
                  profileBins[binIdx]! += cell.volume;
                }
              }
            });
          } else {
            const avgY = priceToY((c.open + c.close + c.high + c.low) / 4);
            if (avgY >= bMinY && avgY <= bMaxY) {
              const avgPrice = (c.open + c.close + c.high + c.low) / 4;
              const binIdx = Math.min(
                bucketCount - 1,
                Math.max(0, Math.floor((maxPrice - avgPrice) / priceStep))
              );
              if (binIdx >= 0) {
                profileBins[binIdx]! += c.volume;
              }
            }
          }
        }

        let totalVolume = 0;
        let maxBinVal = 0;
        let pocIdx = 0;
        for (let b = 0; b < bucketCount; b++) {
          const binVol = profileBins[b]!;
          totalVolume += binVol;
          if (binVol > maxBinVal) {
            maxBinVal = binVol;
            pocIdx = b;
          }
        }

        let lowIdx = pocIdx;
        let highIdx = pocIdx;
        let vaVolume = profileBins[pocIdx]!;
        const targetVolume = totalVolume * 0.7;

        if (totalVolume > 0 && maxBinVal > 0) {
          while (vaVolume < targetVolume && (lowIdx > 0 || highIdx < bucketCount - 1)) {
            let addLowVol = 0;
            let addHighVol = 0;
            if (lowIdx > 0) addLowVol = profileBins[lowIdx - 1]!;
            if (highIdx < bucketCount - 1) addHighVol = profileBins[highIdx + 1]!;

            if (addLowVol >= addHighVol && lowIdx > 0) {
              vaVolume += addLowVol;
              lowIdx--;
            } else if (highIdx < bucketCount - 1) {
              vaVolume += addHighVol;
              highIdx++;
            } else if (lowIdx > 0) {
              vaVolume += addLowVol;
              lowIdx--;
            } else {
              break;
            }
          }
        }

        const maxDrawWidth = Math.abs(x2 - x1) * 0.82;

        ctx.save();

        const vaY1 = bMinY + lowIdx * bHeightStep;
        const vaY2 = bMinY + (highIdx + 1) * bHeightStep;
        ctx.fillStyle = isLight ? "rgba(59, 130, 246, 0.02)" : "rgba(59, 130, 246, 0.03)";
        ctx.fillRect(minX, vaY1, Math.abs(x2 - x1), vaY2 - vaY1);

        for (let b = 0; b < bucketCount; b++) {
          const binVol = profileBins[b]!;
          if (binVol === 0) continue;

          const drawW = (binVol / Math.max(1, maxBinVal)) * maxDrawWidth;
          const binY = bMinY + b * bHeightStep;
          const isInValueArea = b >= lowIdx && b <= highIdx;

          if (isInValueArea) {
            ctx.fillStyle = isLight ? "rgba(59, 130, 246, 0.18)" : "rgba(59, 130, 246, 0.28)";
          } else {
            ctx.fillStyle = isLight ? "rgba(148, 163, 184, 0.06)" : "rgba(148, 163, 184, 0.09)";
          }

          ctx.fillRect(minX, binY, drawW, bHeightStep + 0.25);
        }

        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = isLight ? "rgba(100, 116, 139, 0.20)" : "rgba(148, 163, 184, 0.20)";

        ctx.beginPath();
        ctx.moveTo(minX, vaY1);
        ctx.lineTo(maxX, vaY1);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(minX, vaY2);
        ctx.lineTo(maxX, vaY2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = isLight ? "rgba(100, 116, 139, 0.45)" : "rgba(148, 163, 184, 0.45)";
        ctx.font = "8px 'JetBrains Mono', monospace";
        ctx.fillText("VAH (70%)", maxX - 65, vaY1 - 3);
        ctx.fillText("VAL (70%)", maxX - 65, vaY2 + 9);

        const pocY = bMinY + (pocIdx + 0.5) * bHeightStep;
        ctx.strokeStyle = isLight ? "#2563eb" : "#3b82f6";
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(minX, pocY);
        ctx.lineTo(maxX, pocY);
        ctx.stroke();

        ctx.fillStyle = isLight ? "#1d4ed8" : "#60a5fa";
        ctx.font = "bold 9px 'JetBrains Mono', monospace";
        ctx.fillText("POC", minX + 5, pocY - 4);

        ctx.restore();
      }
    }
  });

  if (layer === "foreground" && selectedDrawingId !== null) {
    const d = drawings.find((item) => item.id === selectedDrawingId);
    if (d) {
      const y1 = priceToY(d.startPrice);
      const y2 = priceToY(d.endPrice);
      const x1 = indexToX(d.startIdx);
      const x2 = indexToX(d.endIdx);

      if (d.type !== "horizontal" && d.type !== "channel") {
        ctx.save();
        ctx.strokeStyle = isLight ? "#2563eb" : "#3b82f6";
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        ctx.restore();
      }

      let handles = [
        { x: x1, y: y1 },
        { x: x2, y: y2 },
        { x: x2, y: y1 },
        { x: x1, y: y2 },
      ];

      if (d.type === "channel") {
        const offsetVal = d.offsetPrice !== undefined ? d.offsetPrice : (activePair.priceStep || 0.1) * 20;
        const y1_offset = priceToY(d.startPrice + offsetVal);
        const y2_offset = priceToY(d.endPrice + offsetVal);
        handles = [
          { x: x1, y: y1 },
          { x: x2, y: y2 },
          { x: x2, y: y2_offset },
          { x: x1, y: y1_offset },
        ];
      }

      handles.forEach((h) => {
        ctx.save();
        ctx.fillStyle = isLight ? "#2563eb" : "#60a5fa";
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.8;
        ctx.shadowBlur = 5;
        ctx.shadowColor = "rgba(37, 99, 235, 0.4)";
        ctx.beginPath();
        ctx.arc(h.x, h.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      });
    }
  }
}
