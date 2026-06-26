import type { IndicatorModule } from "./types";

export interface ClusterSearchSettings {
  mode: "Volume" | "Delta" | "Both";
  direction: "Both" | "Buy" | "Sell";
  location: "Any" | "Body" | "Wick";
  sensitivity: number;
  useMinMax: boolean;
  csMergeLevels: number;
  csImbalancePercent: number;
  csMedEnabled?: boolean;
  csMedMinVolume: number;
  csMedMaxVolume: number;
  csMedMinSize: number;
  csMedMaxSize: number;
  csMedShape: "circle" | "square" | "rhombus";
  csMedColorBid: string;
  csMedColorAsk: string;
  csMedOpacity: number;
  csMedTgAlert: boolean;
  csLargeEnabled?: boolean;
  csLargeMinVolume: number;
  csLargeMinSize: number;
  csLargeMaxSize: number;
  csLargeShape: "circle" | "square" | "rhombus";
  csLargeColorBid: string;
  csLargeColorAsk: string;
  csLargeOpacity: number;
  csLargeTgAlert: boolean;
}

export const clusterSearchIndicator: IndicatorModule & {
  defaultSettings: ClusterSearchSettings;
  drawShape: (
    ctx: CanvasRenderingContext2D,
    shape: "circle" | "square" | "rhombus",
    x: number,
    y: number,
    size: number,
    color: string,
    opacity: number,
    isLight?: boolean
  ) => void;
} = {
  id: "clusterSearch",
  label: "(PROCLUSTER) Cluster Search",
  category: "Все индикаторы",
  type: "Оверлей",
  description: "Сканер аномальных горизонтальных объемов (кластеров) внутри свечей по индивидуально настроенным средним и крупным фильтрам.",
  details: "Автоматически подсвечивает крупные фильтрации на графике различными фигурами(круг, квадрат, ромб). Помогает мгновенно находить крупные покупки и продажи на рынке с перевесом одной из сторон.",
  defaultSettings: {
    mode: "Volume",
    direction: "Both",
    location: "Any",
    sensitivity: 4,
    useMinMax: false,
    csMergeLevels: 1,
    csImbalancePercent: 60,
    csMedEnabled: true,
    csMedMinVolume: 100,
    csMedMaxVolume: 500,
    csMedMinSize: 4,
    csMedMaxSize: 12,
    csMedShape: "circle",
    csMedColorBid: "#ef4444",
    csMedColorAsk: "#10b981",
    csMedOpacity: 0.7,
    csMedTgAlert: false,
    csLargeEnabled: true,
    csLargeMinVolume: 500,
    csLargeMinSize: 10,
    csLargeMaxSize: 20,
    csLargeShape: "rhombus",
    csLargeColorBid: "#f43f5e",
    csLargeColorAsk: "#34d399",
    csLargeOpacity: 0.9,
    csLargeTgAlert: false
  },
  isActiveDefault: false,

  drawShape: (ctx, shape, x, y, size, color, opacity, isLight = false) => {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = color;
    ctx.strokeStyle = isLight ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1.0;

    ctx.beginPath();
    if (shape === "circle") {
      ctx.arc(x, y, size, 0, Math.PI * 2);
    } else if (shape === "square") {
      ctx.rect(x - size, y - size, size * 2, size * 2);
    } else if (shape === "rhombus") {
      ctx.moveTo(x, y - size);
      ctx.lineTo(x + size, y);
      ctx.lineTo(x, y + size);
      ctx.lineTo(x - size, y);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
};
